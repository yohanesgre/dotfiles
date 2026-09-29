use crate::card::{Card, Detected, Example, ExplanationItem, Meta, PhrasePayload, Query,
                  Usage, WordPayload};
use crate::error::{Error, ErrorCode};
use serde::Deserialize;
use serde_json::json;
use std::thread::sleep;
use std::time::Duration;
use unicode_segmentation::UnicodeSegmentation;

pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// Passed to `cache_key` so a prompt change invalidates the cache automatically.
pub const SYSTEM_PROMPT: &str = "\
You are a translation and vocabulary assistant for an Indonesian speaker.
Decide from the input alone whether it is a WORD (a single word or short phrase) \
or a PHRASE (a sentence or longer passage), and set \"kind\" accordingly.
For a WORD: give ipa (IPA, no slashes), pos, translation, meaning, and exactly two \
examples. Leave explanation empty.
  - pos is a short grammatical label only — e.g. adverb, noun, phrasal verb. Never a \
definition, never a sentence, never prose. Anything worth saying about usage or \
register belongs in notes, not in pos.
  - meaning is a one-line gloss of the term in the source language, e.g. \
\"in spite of that; however\". It is never empty for a word.
  - each example has src (a sentence in the source language) and dst (that sentence \
translated into the target language).
For a PHRASE: give the full translation and an explanation of the parts worth knowing \
(phrasal verbs, idioms, register), each as a term and a note. Leave the word fields empty.
translation is in the target language; ipa, pos, meaning and every example's src are in \
the source language.
Write notes only when there is something genuinely useful to say about register or usage.
Produce no commentary outside the JSON.";

/// Pinned so the cache key is stable. Change this and every entry invalidates.
pub const RESPONSE_SCHEMA: &str = r#"{
  "type": "OBJECT",
  "properties": {
    "kind": { "type": "STRING", "enum": ["word", "phrase"] },
    "detected_source": { "type": "STRING", "description": "BCP-47 code of the input language" },
    "translation": { "type": "STRING", "description": "The translation, in the target language" },
    "ipa": { "type": "STRING", "description": "IPA for the word, no slashes" },
    "pos": { "type": "STRING", "description": "A short grammatical label only — e.g. adverb, noun, phrasal verb. Never a definition, a sentence, or prose; explanations belong in notes." },
    "meaning": { "type": "STRING", "description": "A one-line gloss of the term in the source language, e.g. \"in spite of that; however\". Never empty for a word." },
    "examples": {
      "type": "ARRAY",
      "description": "Exactly two entries for a word. src is a sentence in the source language; dst is its translation into the target language.",
      "items": { "type": "OBJECT",
        "properties": { "src": { "type": "STRING" }, "dst": { "type": "STRING" } },
        "required": ["src", "dst"] }
    },
    "explanation": {
      "type": "ARRAY",
      "items": { "type": "OBJECT",
        "properties": { "term": { "type": "STRING" }, "note": { "type": "STRING" } },
        "required": ["term", "note"] }
    },
    "notes": { "type": "STRING" }
  },
  "required": ["kind", "detected_source", "translation", "meaning", "examples"]
}"#;

fn language_name(code: &str) -> &str {
    match code {
        "en" => "English", "id" => "Indonesian", "nl" => "Dutch", "jv" => "Javanese",
        "su" => "Sundanese", "ar" => "Arabic", "es" => "Spanish", "fr" => "French",
        "de" => "German", "ja" => "Japanese", "zh" => "Chinese", other => other,
    }
}

fn direction_line(q: &Query) -> String {
    if q.source == "auto" {
        format!("Detect the source language yourself. Translate into {} ({}).",
                language_name(&q.target), q.target)
    } else {
        format!("Translate from {} ({}) into {} ({}). Explain in {} ({}).",
                language_name(&q.source), q.source,
                language_name(&q.target), q.target,
                language_name(&q.explain_in), q.explain_in)
    }
}

pub fn build_request(q: &Query, model: &str) -> HttpRequest {
    let body = json!({
        "systemInstruction": { "parts": [{ "text": format!("{}\n\n{}", SYSTEM_PROMPT, direction_line(q)) }] },
        "contents": [{ "role": "user", "parts": [{ "text": q.text }] }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": serde_json::from_str::<serde_json::Value>(RESPONSE_SCHEMA).unwrap(),
            "maxOutputTokens": 2048
        }
    });
    HttpRequest {
        method: "POST".into(),
        url: format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"),
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: body.to_string(),
    }
}

#[derive(Debug)]
pub struct RawResponse { pub status: u16, pub body: String }

#[derive(Debug)]
pub enum TransportError { Connect(String), Timeout }

/// The seam that makes the retry policy testable without a network.
pub trait Transport {
    fn send(&self, req: &HttpRequest, headers: &[(String, String)])
        -> Result<RawResponse, TransportError>;
}

/// The per-request wall-clock cap the transport enforces. The retry budget must
/// reserve one of these for every attempt it starts, so both read this number.
pub const REQUEST_TIMEOUT_MS: u64 = 5_000;

pub struct RetryCfg { pub max_attempts: u32, pub base_ms: u64, pub deadline_ms: u64 }

impl Default for RetryCfg {
    // Budget arithmetic, enforced in `post_gemini_with` before every retry.
    // Worst case, against a server that accepts the connection and then never
    // answers (each attempt burns one full `REQUEST_TIMEOUT_MS`):
    //   5s (attempt 1) + 0.4s backoff
    // + 5s (attempt 2) + 0.8s backoff
    // + 5s (attempt 3) = 16.2s ≤ 20s deadline,
    // three attempts, so a timeout is still retried at least once (spec §6:
    // "yes, bounded backoff"). The per-request timeout moved from 15s to 5s
    // because two 15s attempts (30s) cannot fit a 20s budget; flash-lite
    // normally answers in 1-3s, so 5s is not aggressive.
    fn default() -> Self { RetryCfg { max_attempts: 3, base_ms: 400, deadline_ms: 20_000 } }
}

/// Injectable time source, so the wall-clock budget is proven in tests against
/// a simulated clock and the suite never really sleeps for the deadline.
pub trait Clock {
    /// Monotonic milliseconds since the clock was created.
    fn now_ms(&self) -> u64;
    fn sleep_ms(&self, ms: u64);
}

/// The production clock.
pub struct RealClock { start: std::time::Instant }

impl RealClock {
    pub fn new() -> Self { RealClock { start: std::time::Instant::now() } }
}

impl Default for RealClock {
    fn default() -> Self { Self::new() }
}

impl Clock for RealClock {
    fn now_ms(&self) -> u64 { self.start.elapsed().as_millis() as u64 }
    fn sleep_ms(&self, ms: u64) { if ms > 0 { sleep(Duration::from_millis(ms)); } }
}

/// Both rate limits arrive as HTTP 429. A per-minute limit is worth waiting 30
/// seconds for; a daily quota is not worth waiting for at all. The response body
/// is the only thing that distinguishes them.
pub fn classify_429(body: &str) -> ErrorCode {
    let lower = body.to_lowercase();
    let daily = lower.contains("perday") || lower.contains("per day")
        || lower.contains("per-day") || lower.contains("daily");
    if daily { ErrorCode::QuotaExhausted } else { ErrorCode::RateLimited }
}

/// Pulls the `"30s"` out of a `RetryInfo` detail. `None` when the body carries no
/// usable `retryDelay`; the caller falls back to a default.
fn retry_after_secs(body: &str) -> Option<u64> {
    let idx = body.find("retryDelay")?;
    let tail = &body[idx..];
    let start = tail.find('"').and_then(|i| tail[i + 1..].find('"').map(|j| i + 1 + j + 1))?;
    let digits: String = tail[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// How long to wait before retrying a 429. `retry-after` is honoured, but the
/// retry budget (`deadline`) caps it; the budget gate in `post_gemini_with`
/// then refuses the attempt if the wait plus a request cannot fit.
fn retry_sleep_ms(after: u64, waited: u64, deadline: u64) -> u64 {
    after.saturating_mul(1000).min(deadline.saturating_sub(waited))
}

fn rate_limited(after: u64) -> Error {
    Error::new(ErrorCode::RateLimited,
               format!("Rate limited — try again in {after}s")).with_retry(after)
}

pub fn post_gemini(t: &dyn Transport, req: &HttpRequest, key: &str, cfg: &RetryCfg)
    -> Result<RawResponse, Error>
{
    post_gemini_with(t, req, key, cfg, &RealClock::new())
}

/// The retry loop. `deadline_ms` is a genuine overall wall-clock budget: before
/// starting any retry it reserves the next backoff *and* one full request
/// timeout, so the total elapsed time can never exceed the budget. A
/// `deadline_ms` of 0 disables the budget (tests that are not about it).
pub fn post_gemini_with(t: &dyn Transport, req: &HttpRequest, key: &str,
                        cfg: &RetryCfg, clock: &dyn Clock) -> Result<RawResponse, Error>
{
    let mut headers = req.headers.clone();
    headers.push(("x-goog-api-key".into(), key.to_string()));

    let mut attempt = 0u32;
    let start_ms = clock.now_ms();
    loop {
        attempt += 1;
        // The retryable error a spent attempt leaves behind, and the backoff it
        // earned. A non-retryable outcome returns directly.
        let (err, backoff_ms): (Error, u64) = match t.send(req, &headers) {
            Ok(resp) => match resp.status {
                200..=299 => return Ok(resp),
                401 | 403 => return Err(Error::new(ErrorCode::BadKey,
                    "Key rejected — check ~/.config/gloss/key.")),
                400 | 404 => return Err(Error::new(ErrorCode::BadRequest,
                    "The request was rejected — this is a bug in gloss, not in your input.")),
                429 => {
                    let code = classify_429(&resp.body);
                    if code == ErrorCode::QuotaExhausted {
                        return Err(Error::new(ErrorCode::QuotaExhausted,
                            "Daily quota exhausted — the limit resets at midnight Pacific."));
                    }
                    let after = retry_after_secs(&resp.body).unwrap_or(30);
                    let elapsed = clock.now_ms().saturating_sub(start_ms);
                    (rate_limited(after), retry_sleep_ms(after, elapsed, cfg.deadline_ms))
                }
                500..=599 => (Error::new(ErrorCode::Upstream,
                    "Gemini is having trouble — try again in a moment."),
                    cfg.base_ms * u64::from(attempt)),
                other => (Error::new(ErrorCode::Upstream,
                    format!("Unexpected response {other} from Gemini.")),
                    cfg.base_ms * u64::from(attempt)),
            },
            // A timeout is retryable, exactly like a refused connection: same
            // bounded backoff, then the attempt cap decides.
            Err(TransportError::Timeout) => (Error::new(ErrorCode::Timeout,
                "The request timed out — try again."), cfg.base_ms * u64::from(attempt)),
            Err(TransportError::Connect(_)) => (Error::new(ErrorCode::Network,
                "Can't reach Gemini — check your connection."), cfg.base_ms * u64::from(attempt)),
        };

        if attempt >= cfg.max_attempts {
            return Err(err);
        }

        // Budget gate: the next attempt must fit inside the remaining budget,
        // including one full request timeout for it — otherwise it is not
        // started at all and the caller sees the retryable error (with
        // `retry_after` preserved where the 429 arm set it).
        if cfg.deadline_ms != 0 {
            let elapsed = clock.now_ms().saturating_sub(start_ms);
            let need = elapsed.saturating_add(backoff_ms).saturating_add(REQUEST_TIMEOUT_MS);
            if need > cfg.deadline_ms {
                return Err(err);
            }
        }

        clock.sleep_ms(backoff_ms);
    }
}

#[derive(Deserialize)]
struct ModelOut {
    kind: String,
    #[serde(default)] detected_source: String,
    #[serde(default)] translation: String,
    #[serde(default)] ipa: String,
    #[serde(default)] pos: String,
    #[serde(default)] meaning: String,
    #[serde(default)] examples: Vec<Example>,
    #[serde(default)] explanation: Vec<ExplanationItem>,
    #[serde(default)] notes: String,
}

fn opt(s: String) -> Option<String> {
    let t = s.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

/// Pure. Validates the model's JSON against the pinned schema and refuses
/// anything structurally valid but semantically useless.
pub fn parse_card(resp: &RawResponse, q: &Query, model: &str) -> Result<Card, Error> {
    let bad = || Error::new(ErrorCode::BadOutput,
        "The model's answer didn't match the expected shape — retrying once.");

    let envelope: serde_json::Value = serde_json::from_str(&resp.body).map_err(|_| bad())?;
    let text = envelope["candidates"][0]["content"]["parts"][0]["text"]
        .as_str().ok_or_else(bad)?;
    let out: ModelOut = serde_json::from_str(text).map_err(|_| bad())?;

    if out.translation.trim().is_empty() {
        return Err(bad());
    }

    let kind = out.kind.trim().to_string();

    // Shape validation is not enough: the model's JSON is syntactically valid
    // without being semantically correct (spec §3.2). A word with no definition
    // or no examples is as useless as a malformed one, so it earns the same
    // retry-once as any other bad output. Phrase mode has no such fields.
    if kind == "word" {
        if out.meaning.trim().is_empty() {
            return Err(bad());
        }
        if out.examples.is_empty() {
            return Err(bad());
        }
        // `pos` is a label, not prose: anything longer than a handful of words
        // means the model answered a different question. Graphemes, not bytes,
        // so an accented label is measured like any other.
        if out.pos.trim().graphemes(true).count() > 40 {
            return Err(bad());
        }
    }

    let detected = if q.source == "auto" && !out.detected_source.trim().is_empty() {
        // The trimmed kind, so `"word "` cannot leak into the widget's mode.
        Some(Detected { source: out.detected_source.trim().to_string(), mode: kind.clone() })
    } else {
        None
    };

    let usage = Usage {
        input_tokens: envelope["usageMetadata"]["promptTokenCount"].as_u64().unwrap_or(0) as u32,
        output_tokens: envelope["usageMetadata"]["candidatesTokenCount"].as_u64().unwrap_or(0) as u32,
    };
    let meta = Meta { model: model.to_string(), cached: false,
                      fetched_at: now_rfc3339(), warnings: vec![] };

    match kind.as_str() {
        "word" => Ok(Card::Word {
            query: q.clone(), detected,
            payload: WordPayload {
                // The term is always the user's own text, never a rewrite.
                term: q.text.clone(),
                ipa: opt(out.ipa),
                pos: if out.pos.trim().is_empty() { "—".into() } else { out.pos.trim().into() },
                translation: out.translation.trim().to_string(),
                meaning: out.meaning.trim().to_string(),
                examples: out.examples,
                notes: opt(out.notes),
            },
            meta, usage,
        }),
        "phrase" => Ok(Card::Phrase {
            query: q.clone(), detected,
            payload: PhrasePayload {
                translation: out.translation.trim().to_string(),
                explanation: out.explanation,
                notes: opt(out.notes),
            },
            meta, usage,
        }),
        _ => Err(bad()),
    }
}

/// RFC 3339, second precision, UTC — the format the card promises.
pub fn now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    rfc3339_from_secs(secs)
}

/// Pure, so the civil-date maths can be pinned against known timestamps.
fn rfc3339_from_secs(secs: u64) -> String {
    // Days-from-civil, so no chrono dependency for one timestamp.
    let days = secs / 86_400;
    let (h, m, s) = ((secs % 86_400) / 3600, (secs % 3600) / 60, secs % 60);
    let z = days as i64 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// A stall after the handshake must become a timeout, not a permanent block:
/// the default agent sets no read timeout, so this one sets a whole-call one.
/// `REQUEST_TIMEOUT_MS` is shared with the retry budget, which reserves this
/// much time per attempt.
fn transport_error(msg: String) -> TransportError {
    if msg.contains("timed out") { TransportError::Timeout } else { TransportError::Connect(msg) }
}

/// The only place that knows `ureq`.
pub struct UreqTransport { agent: ureq::Agent }

impl UreqTransport {
    pub fn new() -> Self {
        UreqTransport {
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS)).build(),
        }
    }
}

impl Default for UreqTransport {
    fn default() -> Self { Self::new() }
}

impl Transport for UreqTransport {
    fn send(&self, req: &HttpRequest, headers: &[(String, String)])
        -> Result<RawResponse, TransportError>
    {
        let mut r = self.agent.request(&req.method, &req.url);
        for (k, v) in headers { r = r.set(k, v); }
        match r.send_string(&req.body) {
            Ok(resp) => Ok(RawResponse { status: resp.status(),
                                         body: resp.into_string().unwrap_or_default() }),
            Err(ureq::Error::Status(code, resp)) => Ok(RawResponse {
                status: code, body: resp.into_string().unwrap_or_default() }),
            Err(ureq::Error::Transport(t)) => Err(transport_error(t.to_string())),
        }
    }
}

#[cfg(test)]
mod build_tests {
    use super::*;

    fn q(source: &str) -> Query {
        Query { text: "nevertheless".into(), source: source.into(),
                target: "id".into(), explain_in: "id".into() }
    }

    #[test]
    fn url_is_the_generate_content_endpoint() {
        let r = build_request(&q("en"), "gemini-3.5-flash-lite");
        assert_eq!(r.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
        assert_eq!(r.method, "POST");
    }

    #[test]
    fn no_sampling_parameters_are_sent() {
        let body = build_request(&q("en"), "gemini-3.5-flash-lite").body;
        for banned in ["temperature", "topP", "topK", "top_p", "top_k"] {
            assert!(!body.contains(banned), "{banned} is deprecated on 3.x and must not be sent");
        }
    }

    #[test]
    fn structured_output_is_pinned() {
        let body = build_request(&q("en"), "gemini-3.5-flash-lite").body;
        assert!(body.contains("\"responseMimeType\":\"application/json\""));
        assert!(body.contains("\"responseSchema\""));
    }

    #[test]
    fn the_source_language_is_named_explicitly_when_known() {
        let body = build_request(&q("en"), "gemini-3.5-flash-lite").body;
        assert!(body.contains("English"), "a concrete source must be named in the prompt");
        assert!(body.contains("Indonesian"), "the target must be named in the prompt");
    }

    #[test]
    fn auto_source_asks_the_model_to_detect_instead_of_naming_one() {
        let body = build_request(&q("auto"), "gemini-3.5-flash-lite").body;
        assert!(body.contains("detect"), "auto must ask for detection");
        assert!(!body.contains("from English"), "auto must not assert a source language");
    }

    #[test]
    fn the_text_is_embedded_once_and_not_interpreted() {
        let body = build_request(&q("en"), "gemini-3.5-flash-lite").body;
        assert_eq!(body.matches("nevertheless").count(), 1);
    }
}

#[cfg(test)]
mod post_tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    struct Fake {
        script: RefCell<Vec<Result<(u16, String), TransportError>>>,
        calls: RefCell<usize>,
        saw_key: RefCell<Option<String>>,
    }
    impl Fake {
        fn new(script: Vec<Result<(u16, String), TransportError>>) -> Self {
            Fake { script: RefCell::new(script), calls: RefCell::new(0), saw_key: RefCell::new(None) }
        }
    }
    impl Transport for Fake {
        fn send(&self, _r: &HttpRequest, headers: &[(String, String)]) -> Result<RawResponse, TransportError> {
            *self.calls.borrow_mut() += 1;
            *self.saw_key.borrow_mut() = headers.iter()
                .find(|(k, _)| k == "x-goog-api-key").map(|(_, v)| v.clone());
            match self.script.borrow_mut().remove(0) {
                Ok((status, body)) => Ok(RawResponse { status, body }),
                Err(e) => Err(e),
            }
        }
    }

    /// Simulated clock: never sleeps, just records milliseconds. Tests that are
    /// about the budget advance it; the rest keep `deadline_ms: 0`.
    struct RecClock(Cell<u64>);
    impl Clock for RecClock {
        fn now_ms(&self) -> u64 { self.0.get() }
        fn sleep_ms(&self, ms: u64) { self.0.set(self.0.get() + ms); }
    }

    /// A transport that accepts the connection and then never answers: every
    /// send burns one full request timeout on the shared simulated clock.
    struct Stalling { clock: Rc<RecClock>, calls: Cell<usize> }
    impl Transport for Stalling {
        fn send(&self, _r: &HttpRequest, _h: &[(String, String)])
            -> Result<RawResponse, TransportError>
        {
            self.calls.set(self.calls.get() + 1);
            self.clock.0.set(self.clock.0.get() + REQUEST_TIMEOUT_MS);
            Err(TransportError::Timeout)
        }
    }
    // deadline 0 keeps the 429 wait at zero: the wait maths is tested directly
    // in `retry_sleep_tests`, so these tests must not sleep to prove it.
    fn cfg() -> RetryCfg { RetryCfg { max_attempts: 3, base_ms: 1, deadline_ms: 0 } }
    fn req() -> HttpRequest { build_request(&Query {
        text: "x".into(), source: "en".into(), target: "id".into(), explain_in: "id".into() },
        "gemini-3.5-flash-lite") }

    fn ok_body() -> String { "{\"candidates\":[]}".into() }
    fn quota_body() -> String {
        "{\"error\":{\"code\":429,\"status\":\"RESOURCE_EXHAUSTED\",\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.QuotaFailure\",\"violations\":[{\"quotaMetric\":\"generate_content_free_tier_requests\",\"quotaId\":\"GenerateRequestsPerDayPerProjectPerModel-FreeTier\"}]}]}}".into()
    }
    fn rate_body() -> String {
        "{\"error\":{\"code\":429,\"status\":\"RESOURCE_EXHAUSTED\",\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.RetryInfo\",\"retryDelay\":\"30s\"}]}}".into()
    }

    #[test]
    fn the_key_travels_in_the_header_and_never_in_the_body() {
        let f = Fake::new(vec![Ok((200, ok_body()))]);
        let r = req();
        post_gemini(&f, &r, "SECRET", &cfg()).unwrap();
        assert_eq!(f.saw_key.borrow().as_deref(), Some("SECRET"));
        assert!(!r.body.contains("SECRET"), "the key must not appear in the request body");
    }

    #[test]
    fn success_returns_the_body() {
        let f = Fake::new(vec![Ok((200, ok_body()))]);
        assert_eq!(post_gemini(&f, &req(), "k", &cfg()).unwrap().status, 200);
    }

    #[test]
    fn bad_key_is_never_retried() {
        let f = Fake::new(vec![Ok((401, "{}".into()))]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::BadKey);
        assert_eq!(*f.calls.borrow(), 1, "retrying a rejected key is pure waste");
    }

    #[test]
    fn forbidden_is_also_bad_key() {
        let f = Fake::new(vec![Ok((403, "{}".into()))]);
        assert_eq!(post_gemini(&f, &req(), "k", &cfg()).unwrap_err().code, ErrorCode::BadKey);
        assert_eq!(*f.calls.borrow(), 1);
    }

    #[test]
    fn a_malformed_request_is_never_retried() {
        for status in [400u16, 404] {
            let f = Fake::new(vec![Ok((status, "{}".into()))]);
            let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
            assert_eq!(e.code, ErrorCode::BadRequest, "status {status}");
            assert_eq!(*f.calls.borrow(), 1, "resending an identical malformed body cannot help");
        }
    }

    #[test]
    fn daily_quota_is_not_retried_and_reports_the_reset() {
        let f = Fake::new(vec![Ok((429, quota_body()))]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::QuotaExhausted);
        assert_eq!(*f.calls.borrow(), 1, "waiting 30s against a daily cap is futile");
        assert!(e.message.to_lowercase().contains("quota"));
    }

    #[test]
    fn per_minute_limit_is_retried_and_honours_retry_after() {
        let f = Fake::new(vec![Ok((429, rate_body())), Ok((429, rate_body())), Ok((200, ok_body()))]);
        let r = post_gemini(&f, &req(), "k", &cfg()).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(*f.calls.borrow(), 3);
    }

    #[test]
    fn per_minute_limit_that_persists_reports_retry_after() {
        let f = Fake::new(vec![Ok((429, rate_body())), Ok((429, rate_body())), Ok((429, rate_body()))]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::RateLimited);
        assert_eq!(e.retry_after, Some(30));
        assert_eq!(e.message, "Rate limited — try again in 30s");
    }

    #[test]
    fn server_error_is_retried_then_reported_as_upstream() {
        let f = Fake::new(vec![Ok((500, "{}".into())), Ok((500, "{}".into())), Ok((500, "{}".into()))]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::Upstream);
        assert_eq!(*f.calls.borrow(), 3);
    }

    #[test]
    fn an_unexpected_status_is_retried_then_reported_as_upstream() {
        let f = Fake::new(vec![Ok((418, "{}".into())), Ok((418, "{}".into())), Ok((418, "{}".into()))]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::Upstream);
        assert_eq!(*f.calls.borrow(), 3);
        assert!(e.message.contains("418"), "the message names the status it saw");
    }

    #[test]
    fn connection_failure_is_retried_then_network() {
        let f = Fake::new(vec![Err(TransportError::Connect("refused".into())),
                               Err(TransportError::Connect("refused".into())),
                               Err(TransportError::Connect("refused".into()))]);
        assert_eq!(post_gemini(&f, &req(), "k", &cfg()).unwrap_err().code, ErrorCode::Network);
        assert_eq!(*f.calls.borrow(), 3);
    }

    #[test]
    fn a_stall_is_retried_then_reported_as_timeout() {
        // Spec §6: timeout is retried with bounded backoff, like a refused
        // connection — it must not return on the first attempt.
        let f = Fake::new(vec![Err(TransportError::Timeout), Err(TransportError::Timeout),
                               Err(TransportError::Timeout)]);
        let e = post_gemini(&f, &req(), "k", &cfg()).unwrap_err();
        assert_eq!(e.code, ErrorCode::Timeout);
        assert_eq!(*f.calls.borrow(), 3);
    }

    #[test]
    fn a_timeout_recovers_when_a_later_attempt_succeeds() {
        let f = Fake::new(vec![Err(TransportError::Timeout), Ok((200, ok_body()))]);
        assert_eq!(post_gemini(&f, &req(), "k", &cfg()).unwrap().status, 200);
        assert_eq!(*f.calls.borrow(), 2);
    }

    #[test]
    fn a_persistent_stall_stays_inside_the_deadline_and_still_retries() {
        // The product promise: against a server that never answers, the card is
        // due within one budget, and a timeout is still retried at least once.
        let clock = Rc::new(RecClock(Cell::new(0)));
        let t = Stalling { clock: Rc::clone(&clock), calls: Cell::new(0) };
        let e = post_gemini_with(&t, &req(), "k", &RetryCfg::default(), clock.as_ref())
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::Timeout);
        let attempts = t.calls.get();
        assert!(attempts >= 2, "a timeout must still be retried, saw {attempts} attempt(s)");
        let elapsed = clock.now_ms();
        let budget = RetryCfg::default().deadline_ms;
        eprintln!("simulated time-to-card: {elapsed}ms over {attempts} attempts (budget {budget}ms)");
        assert!(elapsed <= budget,
                "simulated time-to-card {elapsed}ms must stay inside the {budget}ms budget");
        assert_eq!(attempts, 3, "the budget fits three 5s attempts: 16.2s ≤ 20s");
    }

    #[test]
    fn the_budget_gate_prevents_an_attempt_that_cannot_finish() {
        // 6s budget cannot fit a second 5s attempt plus backoff, so the first
        // retryable error is returned after a single attempt.
        let clock = Rc::new(RecClock(Cell::new(0)));
        let t = Stalling { clock: Rc::clone(&clock), calls: Cell::new(0) };
        let cfg = RetryCfg { max_attempts: 3, base_ms: 400, deadline_ms: 6_000 };
        let e = post_gemini_with(&t, &req(), "k", &cfg, clock.as_ref()).unwrap_err();
        assert_eq!(e.code, ErrorCode::Timeout);
        assert_eq!(t.calls.get(), 1);
        assert!(clock.now_ms() <= 6_000);
    }

    #[test]
    fn a_429_that_cannot_fit_the_budget_reports_retry_after() {
        // retry-after is 30s plus a 5s attempt; nothing about that fits 20s, so
        // the gate returns the retryable error with its `retry_after` intact.
        let f = Fake::new(vec![Ok((429, rate_body()))]);
        let e = post_gemini(&f, &req(), "k", &RetryCfg::default()).unwrap_err();
        assert_eq!(e.code, ErrorCode::RateLimited);
        assert_eq!(e.retry_after, Some(30));
        assert_eq!(*f.calls.borrow(), 1, "the 30s wait cannot fit the 20s budget");
    }

    #[test]
    fn the_two_429s_are_told_apart_by_the_body() {
        assert_eq!(classify_429(&quota_body()), ErrorCode::QuotaExhausted);
        assert_eq!(classify_429(&rate_body()), ErrorCode::RateLimited);
        assert_eq!(classify_429("{}"), ErrorCode::RateLimited, "unreadable body falls back to retryable");
    }

    #[test]
    fn a_worded_or_hyphenated_daily_limit_is_non_retryable() {
        for body in [
            "per-day limit reached",
            "Daily limit reached",
            "you hit the per day cap",
            "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        ] {
            assert_eq!(classify_429(body), ErrorCode::QuotaExhausted, "{body:?}");
        }
    }

    #[test]
    fn the_transport_error_mapping_surfaces_a_stall_as_timeout() {
        assert!(matches!(transport_error("connection timed out".into()), TransportError::Timeout));
        assert!(matches!(transport_error("refused".into()), TransportError::Connect(_)));
    }
}

#[cfg(test)]
mod retry_sleep_tests {
    use super::*;

    #[test]
    fn retry_after_below_the_deadline_is_honoured_in_full() {
        assert_eq!(retry_sleep_ms(5, 0, 20_000), 5_000);
    }

    #[test]
    fn the_deadline_caps_a_long_retry_after() {
        assert_eq!(retry_sleep_ms(30, 0, 20_000), 20_000);
    }

    #[test]
    fn a_spent_deadline_means_no_further_wait() {
        assert_eq!(retry_sleep_ms(30, 20_000, 20_000), 0);
        assert_eq!(retry_sleep_ms(30, 25_000, 20_000), 0);
    }

    #[test]
    fn retry_after_is_read_from_the_body_and_absent_or_malformed_is_none() {
        assert_eq!(retry_after_secs(r#""retryDelay":"30s""#), Some(30));
        assert_eq!(retry_after_secs(r#""retryDelay":"45s""#), Some(45));
        assert_eq!(retry_after_secs("{}"), None, "no retryDelay at all");
        assert_eq!(retry_after_secs(r#""retryDelay":"abc""#), None, "malformed value");
        assert_eq!(retry_after_secs(r#""retryDelay":"#), None, "truncated value");
    }
}

#[cfg(test)]
mod time_tests {
    use super::*;

    #[test]
    fn known_epochs_render_as_rfc3339() {
        assert_eq!(rfc3339_from_secs(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_secs(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(rfc3339_from_secs(86_400), "1970-01-02T00:00:00Z");
        assert_eq!(rfc3339_from_secs(1_752_000_000), "2025-07-08T18:40:00Z");
        assert_eq!(rfc3339_from_secs(2_147_483_647), "2038-01-19T03:14:07Z");
    }

    #[test]
    fn now_is_a_plausible_rfc3339_timestamp() {
        let s = now_rfc3339();
        assert_eq!(s.len(), 20, "{s:?}");
        assert!(s.ends_with('Z'));
    }
}

#[cfg(test)]
mod parse_tests {
    use super::*;
    use crate::card::*;

    fn q() -> Query {
        Query { text: "nevertheless".into(), source: "en".into(),
                target: "id".into(), explain_in: "id".into() }
    }
    fn resp(model_json: &str) -> RawResponse {
        let envelope = serde_json::json!({
            "candidates": [{ "content": { "parts": [{ "text": model_json }] } }],
            "usageMetadata": { "promptTokenCount": 412, "candidatesTokenCount": 388 }
        });
        RawResponse { status: 200, body: envelope.to_string() }
    }

    const WORD: &str = r#"{"kind":"word","detected_source":"en","ipa":"ˌnevəðəˈles",
      "pos":"adverb","translation":"meskipun demikian, namun",
      "meaning":"in spite of that; however",
      "examples":[{"src":"It was raining.","dst":"Hujan turun."}],
      "explanation":[],"notes":"Formal."}"#;

    const PHRASE: &str = r#"{"kind":"phrase","detected_source":"en",
      "translation":"Dewan direksi enggan menyetujui merger itu.",
      "ipa":"","pos":"","meaning":"",
      "examples":[],
      "explanation":[{"term":"sign off on","note":"phrasal verb, formal approval"}],
      "notes":"Business register."}"#;

    #[test]
    fn a_word_response_becomes_a_word_card() {
        let card = parse_card(&resp(WORD), &q(), "gemini-3.5-flash-lite").unwrap();
        match card {
            Card::Word { payload, meta, usage, .. } => {
                assert_eq!(payload.term, "nevertheless");
                assert_eq!(payload.ipa.as_deref(), Some("ˌnevəðəˈles"));
                assert_eq!(payload.examples.len(), 1);
                assert_eq!(usage.input_tokens, 412);
                assert_eq!(meta.model, "gemini-3.5-flash-lite");
                assert!(!meta.cached);
            }
            other => panic!("expected a word card, got {other:?}"),
        }
    }

    #[test]
    fn a_phrase_response_becomes_a_phrase_card_without_word_fields() {
        let card = parse_card(&resp(PHRASE), &q(), "m").unwrap();
        match card {
            Card::Phrase { payload, .. } => {
                assert_eq!(payload.explanation.len(), 1);
                assert_eq!(payload.explanation[0].term, "sign off on");
            }
            other => panic!("expected a phrase card, got {other:?}"),
        }
    }

    #[test]
    fn non_json_is_bad_output() {
        let e = parse_card(&resp("not json at all"), &q(), "m").unwrap_err();
        assert_eq!(e.code, ErrorCode::BadOutput);
    }

    #[test]
    fn a_missing_required_field_is_bad_output() {
        let e = parse_card(&resp(r#"{"kind":"word","detected_source":"en"}"#), &q(), "m").unwrap_err();
        assert_eq!(e.code, ErrorCode::BadOutput);
    }

    #[test]
    fn an_empty_translation_is_rejected_rather_than_rendered_blank() {
        // Structurally valid JSON, but semantically useless — the docs warn that
        // structured output is syntactically valid without being correct.
        let e = parse_card(&resp(r#"{"kind":"word","detected_source":"en","translation":""}"#),
                           &q(), "m").unwrap_err();
        assert_eq!(e.code, ErrorCode::BadOutput);
    }

    #[test]
    fn an_unknown_kind_is_bad_output() {
        let e = parse_card(&resp(r#"{"kind":"essay","detected_source":"en","translation":"x"}"#),
                           &q(), "m").unwrap_err();
        assert_eq!(e.code, ErrorCode::BadOutput);
    }

    fn word_json(pos: &str, meaning: &str, examples: serde_json::Value) -> String {
        serde_json::json!({
            "kind": "word", "detected_source": "en",
            "translation": "meskipun demikian", "pos": pos,
            "meaning": meaning, "examples": examples,
        }).to_string()
    }

    #[test]
    fn a_word_with_no_meaning_is_bad_output() {
        let body = word_json("adverb", "", serde_json::json!([{"src": "a", "dst": "b"}]));
        assert_eq!(parse_card(&resp(&body), &q(), "m").unwrap_err().code, ErrorCode::BadOutput);
    }

    #[test]
    fn a_word_with_no_examples_is_bad_output() {
        let body = word_json("adverb", "in spite of that; however", serde_json::json!([]));
        assert_eq!(parse_card(&resp(&body), &q(), "m").unwrap_err().code, ErrorCode::BadOutput);
    }

    #[test]
    fn a_pos_that_is_prose_is_bad_output() {
        // The live defect: a long Indonesian explanation crammed into the label.
        let body = word_json(&"x".repeat(41), "in spite of that; however",
                             serde_json::json!([{"src": "a", "dst": "b"}]));
        assert_eq!(parse_card(&resp(&body), &q(), "m").unwrap_err().code, ErrorCode::BadOutput);
    }

    #[test]
    fn a_pos_is_measured_in_graphemes_not_bytes() {
        // Forty graphemes, eighty bytes: a byte cap would reject a valid label.
        let pos: String = "e\u{0301}".repeat(40);
        let body = word_json(&pos, "a gloss", serde_json::json!([{"src": "a", "dst": "b"}]));
        assert!(parse_card(&resp(&body), &q(), "m").is_ok(), "40 graphemes is still a label");
    }

    #[test]
    fn auto_source_records_what_was_detected() {
        let mut qq = q(); qq.source = "auto".into();
        match parse_card(&resp(WORD), &qq, "m").unwrap() {
            Card::Word { detected, .. } => {
                assert_eq!(detected.unwrap().source, "en");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_detected_mode_is_trimmed() {
        let mut qq = q(); qq.source = "auto".into();
        // A word payload must now carry a meaning and examples to be accepted;
        // the trailing space in `kind` is the only thing this test exercises.
        let body = r#"{"kind":"word ","detected_source":"en","translation":"x",
          "meaning":"a gloss","examples":[{"src":"a","dst":"b"}]}"#;
        match parse_card(&resp(body), &qq, "m").unwrap() {
            Card::Word { detected, .. } => assert_eq!(detected.unwrap().mode, "word"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_concrete_source_records_no_detection() {
        match parse_card(&resp(WORD), &q(), "m").unwrap() {
            Card::Word { detected, .. } => assert!(detected.is_none()),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_missing_response_text_is_bad_output() {
        let r = RawResponse { status: 200, body: "{\"candidates\":[]}".into() };
        assert_eq!(parse_card(&r, &q(), "m").unwrap_err().code, ErrorCode::BadOutput);
    }
}
