use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub model: String,
    pub cap: usize,          // graphemes, never bytes
    pub source: String,      // "auto" | a language code
    pub target: String,
    pub explain_in: String,
    pub key_path: PathBuf,
    pub cache_path: PathBuf,
}

impl Default for Config {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        Config {
            model: "gemini-3.5-flash-lite".into(),
            cap: 1000,
            source: "auto".into(),
            target: "id".into(),
            explain_in: String::new(),
            key_path: PathBuf::from(&home).join(".config/gloss/key"),
            cache_path: PathBuf::from(&home).join(".cache/gloss/cache.redb"),
        }
    }
}

fn env_usize(name: &str) -> Option<usize> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}
fn env_str(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// Reads config.toml if present. A missing OR malformed file falls back to
/// defaults — a broken config must never be able to stop a lookup.
pub fn load_config(path: Option<&Path>) -> Config {
    let mut cfg = Config::default();
    if let Some(p) = path {
        if let Ok(text) = std::fs::read_to_string(p) {
            if let Ok(file) = toml::from_str::<Config>(&text) {
                cfg = file;
            }
        }
    }
    if let Some(v) = env_str("GLOSS_MODEL") { cfg.model = v; }
    if let Some(v) = env_usize("GLOSS_CAP") { cfg.cap = v; }
    if let Some(v) = env_str("GLOSS_SOURCE") { cfg.source = v; }
    if let Some(v) = env_str("GLOSS_TARGET") { cfg.target = v; }
    if let Some(v) = env_str("GLOSS_EXPLAIN_IN") { cfg.explain_in = v; }
    if let Some(v) = env_str("GLOSS_KEY_PATH") { cfg.key_path = PathBuf::from(v); }
    cfg
}

/// The default config path: ~/.config/gloss/config.toml
pub fn default_path() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config/gloss/config.toml"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Env vars are process-global; the shared lock keeps env-mutating tests
    // here and in `key.rs` from racing each other.
    fn lock() -> std::sync::MutexGuard<'static, ()> {
        crate::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn defaults_match_the_spec() {
        let c = Config::default();
        assert_eq!(c.model, "gemini-3.5-flash-lite");
        assert_eq!(c.cap, 1000);
        assert_eq!(c.target, "id");
        assert_eq!(c.explain_in, "", "an empty explain_in means follow the target");
        assert_eq!(c.source, "auto");
    }

    #[test]
    fn missing_file_yields_defaults() {
        let _g = lock();
        let c = load_config(Some(std::path::Path::new("/nonexistent/config.toml")));
        assert_eq!(c.model, "gemini-3.5-flash-lite");
    }

    #[test]
    fn file_overrides_defaults() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, "model = \"gemini-3.8-flash\"\ncap = 500\n").unwrap();
        let c = load_config(Some(&p));
        assert_eq!(c.model, "gemini-3.8-flash");
        assert_eq!(c.cap, 500);
        assert_eq!(c.target, "id", "unspecified keys keep their default");
    }

    #[test]
    fn env_overrides_file() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, "cap = 500\n").unwrap();
        std::env::set_var("GLOSS_CAP", "750");
        let c = load_config(Some(&p));
        std::env::remove_var("GLOSS_CAP");
        assert_eq!(c.cap, 750);
    }

    #[test]
    fn malformed_file_yields_defaults_not_a_panic() {
        let _g = lock();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, "this is not toml ===").unwrap();
        let c = load_config(Some(&p));
        assert_eq!(c.cap, 1000);
    }
}
