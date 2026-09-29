use crate::card::Query;
use crate::config::Config;
use crate::error::{Error, ErrorCode};

/// Resolves the language triple. `source` may legitimately be "auto" — that is
/// passed through rather than guessed here, because the model is better at it
/// than a heuristic, and the card shows what it detected so it can be corrected.
pub fn detect_direction(text: &str, cfg: &Config) -> Query {
    Query {
        text: text.to_string(),
        source: cfg.source.clone(),
        target: cfg.target.clone(),
        explain_in: cfg.explain_in.clone(),
    }
}

/// One language code as the CLI accepts it: the literal `auto`, or a
/// BCP-47-ish tag matching `^[a-z]{2,3}(-[A-Za-z]{2,4})?$`. Everything else —
/// an empty string, a free-form phrase, a shell fragment — is refused.
///
/// The flags are untrusted input: the widget builds its command through a
/// shell, so a value that is not a language code must never be carried on.
pub fn validate_language(value: &str) -> Result<String, Error> {
    let v = value.trim();
    if v == "auto" || is_language_code(v) {
        return Ok(v.to_string());
    }
    Err(Error::new(
        ErrorCode::BadRequest,
        format!("Invalid language code {value:?} — expected \"auto\" or a code like en, id, pt-BR."),
    ))
}

fn is_language_code(s: &str) -> bool {
    let mut parts = s.split('-');
    let primary = parts.next().unwrap_or("");
    let region = parts.next();
    if parts.next().is_some() {
        return false; // more than one hyphen: not a language tag
    }
    let primary_ok = (2..=3).contains(&primary.len())
        && primary.chars().all(|c| c.is_ascii_lowercase());
    match region {
        None => primary_ok,
        Some(r) => {
            primary_ok
                && (2..=4).contains(&r.len())
                && r.chars().all(|c| c.is_ascii_alphabetic())
        }
    }
}

/// One invocation's language overrides, each already through
/// `validate_language`. They win over `config.toml` for that invocation; the
/// config stays the default for any flag that was not given.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct LanguageOverrides {
    pub source: Option<String>,
    pub target: Option<String>,
    pub explain_in: Option<String>,
}

impl LanguageOverrides {
    pub fn apply(&self, cfg: &mut Config) {
        if let Some(v) = &self.source {
            cfg.source = v.clone();
        }
        if let Some(v) = &self.target {
            cfg.target = v.clone();
        }
        if let Some(v) = &self.explain_in {
            cfg.explain_in = v.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_values_are_carried_through() {
        let cfg = Config { source: "en".into(), target: "id".into(),
                           explain_in: "id".into(), ..Config::default() };
        let q = detect_direction("nevertheless", &cfg);
        assert_eq!(q.source, "en");
        assert_eq!(q.target, "id");
        assert_eq!(q.explain_in, "id");
        assert_eq!(q.text, "nevertheless");
    }

    #[test]
    fn auto_source_is_passed_through_verbatim() {
        let cfg = Config { source: "auto".into(), ..Config::default() };
        assert_eq!(detect_direction("uang", &cfg).source, "auto");
    }

    #[test]
    fn explain_language_defaults_to_indonesian() {
        assert_eq!(detect_direction("x", &Config::default()).explain_in, "id");
    }

    #[test]
    fn a_language_flag_overrides_the_config_for_that_invocation() {
        let mut cfg = Config { source: "auto".into(), target: "id".into(),
                               explain_in: "id".into(), ..Config::default() };
        let o = LanguageOverrides {
            source: Some("en".into()),
            target: Some("nl".into()),
            explain_in: Some("en".into()),
        };
        o.apply(&mut cfg);
        let q = detect_direction("nevertheless", &cfg);
        assert_eq!(q.source, "en");
        assert_eq!(q.target, "nl");
        assert_eq!(q.explain_in, "en");
    }

    #[test]
    fn an_absent_flag_keeps_the_config_value() {
        let mut cfg = Config { source: "auto".into(), target: "id".into(),
                               explain_in: "id".into(), ..Config::default() };
        LanguageOverrides { source: Some("en".into()), ..Default::default() }.apply(&mut cfg);
        let q = detect_direction("x", &cfg);
        assert_eq!(q.source, "en");
        assert_eq!(q.target, "id", "an absent --target keeps the config");
        assert_eq!(q.explain_in, "id", "an absent --explain-in keeps the config");
    }

    #[test]
    fn auto_is_a_valid_language_flag_value() {
        assert_eq!(validate_language("auto").unwrap(), "auto");
    }

    #[test]
    fn plain_and_regioned_codes_are_valid() {
        for code in ["en", "id", "jv", "zh", "pt-BR", "en-US", "id-ID"] {
            assert_eq!(validate_language(code).unwrap(), code, "{code:?}");
        }
    }

    #[test]
    fn malformed_language_values_are_rejected() {
        for bad in [
            "",
            "EN",
            "a",
            "toolong",
            "e",
            "en; touch /tmp/gloss-pwned",
            "$(id)",
            "en us",
            "en-US-x",
            "en-",
            "-en",
            "auto-extra",
            "en_US",
        ] {
            let e = validate_language(bad).unwrap_err();
            assert_eq!(e.code, crate::error::ErrorCode::BadRequest, "{bad:?}");
            assert!(!e.message.is_empty());
        }
    }

    #[test]
    fn surrounding_whitespace_is_trimmed_not_accepted_raw() {
        assert_eq!(validate_language("  en  ").unwrap(), "en");
    }
}
