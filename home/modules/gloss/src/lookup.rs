use crate::card::{render_json, Card};
use crate::cache::{cache_key, Cache};
use crate::config::Config;
use crate::error::{Error, ErrorCode};
use crate::gemini::{build_request, parse_card, post_gemini, RetryCfg, Transport,
                   RESPONSE_SCHEMA, SYSTEM_PROMPT};

pub struct LookupRequest {
    pub text: String,
    pub config: Config,
    pub key: String,
    /// `--refresh`: skip `cache_get` and ask again. The stochastic escape hatch —
    /// without it a bad answer is permanent for that input. Still writes, so the
    /// fresh answer is the one later plain lookups serve.
    pub refresh: bool,
}

/// The whole graph. Returns a Card for every outcome — errors are values.
pub fn lookup(req: &LookupRequest, t: &dyn Transport, cache: &Cache) -> Card {
    match try_lookup(req, t, cache) {
        Ok(card) => card,
        Err(e) => Card::error(&e),
    }
}

fn try_lookup(req: &LookupRequest, t: &dyn Transport, cache: &Cache) -> Result<Card, Error> {
    let text = crate::input::validate(&req.text, req.config.cap)?;

    let q = crate::lang::detect_direction(&text, &req.config);
    let key_hash = cache_key(&q, &req.config.model, SYSTEM_PROMPT, RESPONSE_SCHEMA);

    // Cache first — unless `--refresh` asked for a re-roll. A hit must work
    // with no API key present at all; refresh is the one path that deliberately
    // misses, so it still needs a key below.
    if !req.refresh {
        if let Some(mut card) = cache.get(&key_hash) {
            if let Card::Word { meta, .. } | Card::Phrase { meta, .. } = &mut card {
                meta.cached = true;
            }
            return Ok(card);
        }
    }

    if req.key.trim().is_empty() {
        return Err(Error::new(ErrorCode::MissingKey,
            format!("No API key — expected at {}.", req.config.key_path.display())));
    }

    let http_req = build_request(&q, &req.config.model);

    // bad_output is retried exactly once, because model output is stochastic.
    let mut last: Option<Error> = None;
    for _ in 0..2 {
        let resp = post_gemini(t, &http_req, &req.key, &RetryCfg::default())?;
        match parse_card(&resp, &q, &req.config.model) {
            Ok(card) => {
                cache.put(&key_hash, &card);   // successes only
                return Ok(card);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| Error::new(ErrorCode::BadOutput, "No answer from the model.")))
}

pub fn emit(card: &Card) {
    println!("{}", render_json(card));
}
