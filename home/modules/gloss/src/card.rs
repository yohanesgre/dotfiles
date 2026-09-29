use serde::{Deserialize, Serialize};
use crate::error::ErrorCode;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Query {
    pub text: String,
    pub source: String,       // "auto" | "en" | "id" | ...
    pub target: String,
    pub explain_in: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Detected { pub source: String, pub mode: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Example { pub src: String, pub dst: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WordPayload {
    pub term: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub ipa: Option<String>,
    pub pos: String,
    pub translation: String,
    pub meaning: String,
    pub examples: Vec<Example>,
    #[serde(skip_serializing_if = "Option::is_none")] pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplanationItem { pub term: String, pub note: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhrasePayload {
    pub translation: String,
    pub explanation: Vec<ExplanationItem>,
    #[serde(skip_serializing_if = "Option::is_none")] pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    pub model: String,
    pub cached: bool,
    pub fetched_at: String,
    pub warnings: Vec<String>,   // reserved: no producer today
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Usage { pub input_tokens: u32, pub output_tokens: u32 }

/// The whole contract. Internally tagged on `kind`, so a `Word` card cannot
/// carry a phrase payload — the type system enforces what the spec promises.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Card {
    Word { query: Query, detected: Option<Detected>,
           payload: WordPayload, meta: Meta, usage: Usage },
    Phrase { query: Query, detected: Option<Detected>,
             payload: PhrasePayload, meta: Meta, usage: Usage },
    Error { code: ErrorCode, message: String,
            #[serde(skip_serializing_if = "Option::is_none")] retry_after: Option<u64> },
}

impl Card {
    pub fn error(e: &crate::error::Error) -> Self {
        Card::Error { code: e.code, message: e.message.clone(), retry_after: e.retry_after }
    }
}

/// The single function the widget depends on. Pure: no I/O, no clock.
pub fn render_json(card: &Card) -> String {
    serde_json::to_string(card).expect("Card is always serialisable")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> Meta {
        Meta { model: "gemini-3.5-flash-lite".into(), cached: false,
               fetched_at: "2026-09-29T14:02:11Z".into(), warnings: vec![] }
    }
    fn usage() -> Usage { Usage { input_tokens: 412, output_tokens: 388 } }

    #[test]
    fn word_card_serialises_with_kind_and_payload() {
        let card = Card::Word {
            query: Query { text: "nevertheless".into(), source: "en".into(),
                           target: "id".into(), explain_in: "id".into() },
            detected: None,
            payload: WordPayload {
                term: "nevertheless".into(), ipa: Some("ˌnevəðəˈles".into()),
                pos: "adverb".into(), translation: "meskipun demikian, namun".into(),
                meaning: "in spite of that; however".into(),
                examples: vec![Example { src: "It was raining.".into(),
                                         dst: "Hujan turun.".into() }],
                notes: None,
            },
            meta: meta(), usage: usage(),
        };
        let v: serde_json::Value = serde_json::from_str(&render_json(&card)).unwrap();
        assert_eq!(v["kind"], "word");
        assert_eq!(v["payload"]["ipa"], "ˌnevəðəˈles");
        assert_eq!(v["payload"]["examples"][0]["dst"], "Hujan turun.");
        assert!(v["payload"].get("notes").is_none(), "None must be omitted, not null");
    }

    #[test]
    fn error_card_carries_code_and_retry_after() {
        let card = Card::Error {
            code: ErrorCode::RateLimited, message: "Rate limited — try again in 30s".into(),
            retry_after: Some(30),
        };
        let v: serde_json::Value = serde_json::from_str(&render_json(&card)).unwrap();
        assert_eq!(v["kind"], "error");
        assert_eq!(v["code"], "rate_limited");
        assert_eq!(v["retry_after"], 30);
    }

    #[test]
    fn error_card_omits_retry_after_when_absent() {
        let card = Card::Error {
            code: ErrorCode::Network, message: "Can't reach Gemini — check your connection.".into(),
            retry_after: None,
        };
        let v: serde_json::Value = serde_json::from_str(&render_json(&card)).unwrap();
        assert!(v.get("retry_after").is_none(), "None must be omitted, not null");
    }

    #[test]
    fn every_error_code_round_trips_as_snake_case() {
        for code in ErrorCode::ALL {
            let s = serde_json::to_string(&code).unwrap();
            assert_eq!(s, format!("\"{}\"", code.as_str()));
            assert_eq!(ErrorCode::ALL.len(), 11, "the taxonomy is exactly eleven codes");
        }
    }

    #[test]
    fn non_retryable_set_is_exactly_six() {
        let non: Vec<_> = ErrorCode::ALL.iter().filter(|c| !c.is_retryable()).collect();
        assert_eq!(non.len(), 6);
        for c in [ErrorCode::BadKey, ErrorCode::MissingKey, ErrorCode::EmptyInput,
                  ErrorCode::OverCap, ErrorCode::QuotaExhausted, ErrorCode::BadRequest] {
            assert!(!c.is_retryable(), "{c:?} must not be retryable");
        }
    }
}
