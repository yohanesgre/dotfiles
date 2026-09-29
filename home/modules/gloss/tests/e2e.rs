use gloss::card::Card;
use gloss::cache::Cache;
use gloss::gemini::{HttpRequest, RawResponse, Transport, TransportError};
use gloss::lookup::{lookup, LookupRequest};
use std::cell::RefCell;

struct FakeHttp { replies: RefCell<Vec<String>>, calls: RefCell<usize> }
impl Transport for FakeHttp {
    fn send(&self, _r: &HttpRequest, _h: &[(String, String)]) -> Result<RawResponse, TransportError> {
        *self.calls.borrow_mut() += 1;
        let text = self.replies.borrow_mut().remove(0);
        Ok(RawResponse { status: 200, body: serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": text }] } }],
            "usageMetadata": { "promptTokenCount": 10, "candidatesTokenCount": 20 }
        }).to_string() })
    }
}

const WORD: &str = r#"{"kind":"word","detected_source":"en","ipa":"ˌnevəðəˈles",
  "pos":"adverb","translation":"meskipun demikian, namun",
  "meaning":"in spite of that; however",
  "examples":[{"src":"It was raining.","dst":"Hujan turun."}],
  "explanation":[],"notes":"Formal."}"#;

fn req(text: &str) -> LookupRequest {
    LookupRequest {
        text: text.into(),
        config: gloss::config::Config::default(),
        key: "test-key".into(),
        refresh: false,
    }
}

#[test]
fn a_lookup_produces_a_word_card() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into()]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    match lookup(&req("nevertheless"), &http, &cache) {
        Card::Word { payload, meta, .. } => {
            assert_eq!(payload.translation, "meskipun demikian, namun");
            assert!(!meta.cached, "a first lookup is not cached");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 1);
}

#[test]
fn a_second_identical_lookup_serves_from_cache_with_no_request() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into()]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let r = req("nevertheless");
    let _ = lookup(&r, &http, &cache);
    match lookup(&r, &http, &cache) {
        Card::Word { meta, .. } => assert!(meta.cached, "the second lookup must be a hit"),
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 1, "a cache hit makes no request at all");
}

#[test]
fn a_cache_hit_needs_no_api_key() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into()]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let mut r = req("nevertheless");
    let _ = lookup(&r, &http, &cache);
    r.key = String::new();                       // key gone
    match lookup(&r, &http, &cache) {
        Card::Word { meta, .. } => assert!(meta.cached),
        other => panic!("a hit must work with no key at all, got {other:?}"),
    }
}

#[test]
fn refresh_bypasses_the_cache_and_makes_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into(), WORD.into()]),
                          calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let mut r = req("nevertheless");
    let _ = lookup(&r, &http, &cache);            // populates the cache
    assert_eq!(*http.calls.borrow(), 1);

    r.refresh = true;
    match lookup(&r, &http, &cache) {
        Card::Word { meta, .. } => assert!(!meta.cached, "a refresh is never served from cache"),
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 2, "refresh must reach the network despite a warm cache");

    r.refresh = false;
    match lookup(&r, &http, &cache) {
        Card::Word { meta, .. } => assert!(meta.cached, "the refresh write is what a plain lookup hits"),
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 2, "a plain lookup with a warm cache makes no call");
}

#[test]
fn refresh_on_a_cold_cache_still_writes() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into()]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let mut r = req("nevertheless");
    r.refresh = true;
    let _ = lookup(&r, &http, &cache);
    assert_eq!(*http.calls.borrow(), 1);

    r.refresh = false;
    match lookup(&r, &http, &cache) {
        Card::Word { meta, .. } => assert!(meta.cached, "refresh still writes, so the next plain lookup hits"),
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 1, "the following plain lookup must not call");
}

#[test]
fn bad_output_is_retried_exactly_once_then_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec!["garbage".into(), WORD.into()]),
                          calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    match lookup(&req("nevertheless"), &http, &cache) {
        Card::Word { .. } => {}
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 2, "retried once, then accepted");
}

#[test]
fn persistent_bad_output_becomes_an_error_card_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec!["garbage".into(), "garbage".into()]),
                          calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    match lookup(&req("nevertheless"), &http, &cache) {
        Card::Error { code, .. } => assert_eq!(code, gloss::error::ErrorCode::BadOutput),
        other => panic!("{other:?}"),
    }
}

#[test]
fn over_cap_never_reaches_the_network() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let mut r = req(&"a".repeat(1001));
    r.config.cap = 1000;
    match lookup(&r, &http, &cache) {
        Card::Error { code, .. } => assert_eq!(code, gloss::error::ErrorCode::OverCap),
        other => panic!("{other:?}"),
    }
    assert_eq!(*http.calls.borrow(), 0, "refused before any call");
}

#[test]
fn every_card_serialises_to_valid_json() {
    let dir = tempfile::tempdir().unwrap();
    let http = FakeHttp { replies: RefCell::new(vec![WORD.into()]), calls: RefCell::new(0) };
    let cache = Cache::open(&dir.path().join("c.redb"));
    let card = lookup(&req("nevertheless"), &http, &cache);
    let s = gloss::card::render_json(&card);
    let v: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert!(v["kind"].is_string(), "the widget always receives a kind");
}
