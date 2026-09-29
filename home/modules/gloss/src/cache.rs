use crate::card::Query;
use crate::card::Card;
use redb::{Database, Durability, ReadableTable, ReadableTableMetadata, TableDefinition};
use serde::Serialize;

/// Field order is fixed by the struct, so the serialisation is canonical.
/// Hashing the prompt and schema means cache invalidation is automatic: change
/// the prompt and every old entry stops matching, with nobody remembering to
/// bump a version constant.
#[derive(Serialize)]
struct KeyParts<'a> {
    text: &'a str,
    source: &'a str,
    target: &'a str,
    explain_in: &'a str,
    model: &'a str,
    prompt_hash: String,
    schema_hash: String,
}

pub fn cache_key(q: &Query, model: &str, prompt: &str, schema: &str) -> [u8; 32] {
    let parts = KeyParts {
        text: &q.text,
        source: &q.source,
        target: &q.target,
        explain_in: &q.explain_in,
        model,
        prompt_hash: blake3::hash(prompt.as_bytes()).to_hex().to_string(),
        schema_hash: blake3::hash(schema.as_bytes()).to_hex().to_string(),
    };
    let canonical = serde_json::to_vec(&parts).expect("KeyParts is always serialisable");
    *blake3::hash(&canonical).as_bytes()
}

const CARDS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("cards");

pub struct Stats { pub entries: u64, pub bytes: u64 }

pub struct Cache { db: Option<Database> }

impl Cache {
    /// Never fails. If the file cannot be opened the cache is simply absent,
    /// and every `get` is a miss. A cache must not be able to break the tool.
    pub fn open(path: &std::path::Path) -> Cache {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Cache { db: Database::create(path).ok() }
    }

    pub fn get(&self, key: &[u8; 32]) -> Option<Card> {
        let db = self.db.as_ref()?;
        let txn = db.begin_read().ok()?;
        // A read on a table that was never created errors rather than returning
        // nothing, so first-run must be treated as a miss.
        let table = txn.open_table(CARDS).ok()?;
        let guard = table.get(&key[..]).ok()??;
        serde_json::from_slice(guard.value()).ok()   // corrupt -> None -> miss
    }

    /// Best-effort. A failed write must never fail a good lookup.
    pub fn put(&self, key: &[u8; 32], card: &Card) {
        let Some(db) = self.db.as_ref() else { return };
        let Ok(bytes) = serde_json::to_vec(card) else { return };
        let Ok(mut txn) = db.begin_write() else { return };
        // A cache does not need crash durability: worst case we re-ask Gemini.
        let Ok(mut table) = txn.open_table(CARDS) else { return };
        if table.insert(&key[..], bytes.as_slice()).is_err() { return; }
        drop(table);
        txn.set_durability(Durability::None);
        let _ = txn.commit();
    }

    pub fn stats(&self) -> Stats {
        let Some(db) = self.db.as_ref() else { return Stats { entries: 0, bytes: 0 } };
        let Ok(txn) = db.begin_read() else { return Stats { entries: 0, bytes: 0 } };
        match txn.open_table(CARDS) {
            Ok(t) => Stats {
                entries: t.len().unwrap_or(0),
                bytes: t.iter().ok()
                    .map(|i| i.filter_map(|r| r.ok()).map(|(_, v)| v.value().len() as u64).sum())
                    .unwrap_or(0),
            },
            Err(_) => Stats { entries: 0, bytes: 0 },
        }
    }

    pub fn clear(&self) -> Result<(), crate::error::Error> {
        use crate::error::ErrorCode;
        let db = self.db.as_ref().ok_or_else(|| {
            crate::error::Error::new(ErrorCode::Network, "No cache file to clear.")
        })?;
        let txn = db.begin_write().map_err(|_| {
            crate::error::Error::new(ErrorCode::Network, "Could not open the cache for writing.")
        })?;
        { let _ = txn.delete_table(CARDS); }
        txn.commit().map_err(|_| {
            crate::error::Error::new(ErrorCode::Network, "Could not commit the cache clear.")
        })?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn raw_put_for_test(&self, key: &[u8; 32], bytes: &[u8]) {
        let db = self.db.as_ref().unwrap();
        let txn = db.begin_write().unwrap();
        { txn.open_table(CARDS).unwrap().insert(&key[..], bytes).unwrap(); }
        txn.commit().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(text: &str, source: &str) -> Query {
        Query { text: text.into(), source: source.into(),
                target: "id".into(), explain_in: "id".into() }
    }
    const M: &str = "gemini-3.5-flash-lite";
    const P: &str = "you are a translator";
    const S: &str = "{\"type\":\"object\"}";

    #[test]
    fn identical_inputs_give_identical_keys() {
        assert_eq!(cache_key(&q("a", "en"), M, P, S), cache_key(&q("a", "en"), M, P, S));
    }

    #[test]
    fn naive_concatenation_would_collide_but_this_does_not() {
        // A naive format!("{source}|{text}") makes these the same string:
        //   "en" + "|" + "x|id"  ==  "en|x" + "|" + "id"  ==  "en|x|id"
        let a = cache_key(&q("x|id", "en"), M, P, S);
        let b = cache_key(&q("id", "en|x"), M, P, S);
        assert_ne!(a, b, "canonical serialisation must not be delimiter-injectable");
    }

    #[test]
    fn changing_the_prompt_changes_the_key() {
        assert_ne!(cache_key(&q("a", "en"), M, P, S), cache_key(&q("a", "en"), M, "new prompt", S));
    }

    #[test]
    fn changing_the_schema_changes_the_key() {
        assert_ne!(cache_key(&q("a", "en"), M, P, S), cache_key(&q("a", "en"), M, P, "{}"));
    }

    #[test]
    fn changing_the_model_changes_the_key() {
        assert_ne!(cache_key(&q("a", "en"), M, P, S), cache_key(&q("a", "en"), "gemini-3.8-flash", P, S));
    }

    #[test]
    fn changing_any_language_field_changes_the_key() {
        let base = q("a", "en");
        let mut t = base.clone(); t.target = "fr".into();
        let mut e = base.clone(); e.explain_in = "en".into();
        assert_ne!(cache_key(&base, M, P, S), cache_key(&t, M, P, S));
        assert_ne!(cache_key(&base, M, P, S), cache_key(&e, M, P, S));
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use crate::card::*;

    fn card(text: &str) -> Card {
        Card::Word {
            query: Query { text: text.into(), source: "en".into(),
                           target: "id".into(), explain_in: "id".into() },
            detected: None,
            payload: WordPayload { term: text.into(), ipa: None, pos: "adverb".into(),
                translation: "meskipun demikian".into(), meaning: "however".into(),
                examples: vec![], notes: None },
            meta: Meta { model: "gemini-3.5-flash-lite".into(), cached: false,
                         fetched_at: "2026-09-29T14:02:11Z".into(), warnings: vec![] },
            usage: Usage { input_tokens: 1, output_tokens: 2 },
        }
    }

    #[test]
    fn put_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let c = Cache::open(&dir.path().join("c.redb"));
        let k = [7u8; 32];
        assert!(c.get(&k).is_none(), "cold cache is a miss");
        c.put(&k, &card("nevertheless"));
        assert_eq!(c.get(&k), Some(card("nevertheless")));
    }

    #[test]
    fn missing_file_is_a_miss_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let c = Cache::open(&dir.path().join("does-not-exist.redb"));
        assert!(c.get(&[1u8; 32]).is_none());
    }

    #[test]
    fn corrupt_entry_is_a_miss_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let c = Cache::open(&dir.path().join("c.redb"));
        c.raw_put_for_test(&[9u8; 32], b"this is not json");
        assert!(c.get(&[9u8; 32]).is_none(), "corrupt must degrade to a miss");
    }

    #[test]
    fn stats_report_entry_count() {
        let dir = tempfile::tempdir().unwrap();
        let c = Cache::open(&dir.path().join("c.redb"));
        c.put(&[1u8; 32], &card("a"));
        c.put(&[2u8; 32], &card("b"));
        assert_eq!(c.stats().entries, 2);
    }

    #[test]
    fn clear_empties_the_table() {
        let dir = tempfile::tempdir().unwrap();
        let c = Cache::open(&dir.path().join("c.redb"));
        c.put(&[1u8; 32], &card("a"));
        c.clear().unwrap();
        assert_eq!(c.stats().entries, 0);
        assert!(c.get(&[1u8; 32]).is_none());
    }

    #[test]
    fn clearing_an_unopenable_cache_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        // A file cannot be a parent directory, so the cache never opens.
        let c = Cache::open(&blocker.join("sub/c.redb"));
        let e = c.clear().unwrap_err();
        assert_eq!(e.code, crate::error::ErrorCode::Network);
        assert_eq!(c.stats().entries, 0, "an absent cache reports empty, not a panic");
    }

    #[test]
    fn a_second_concurrent_writer_does_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.redb");
        let a = Cache::open(&p);
        let b = Cache::open(&p);
        a.put(&[1u8; 32], &card("a"));
        b.put(&[2u8; 32], &card("b"));  // must not panic; may be dropped
        assert!(a.get(&[1u8; 32]).is_some());
    }
}
