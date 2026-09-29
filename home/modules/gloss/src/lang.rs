use crate::card::Query;
use crate::config::Config;

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
}
