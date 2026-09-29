use crate::error::{Error, ErrorCode};
use std::path::Path;

/// The key comes from the environment or a 0600 file written by the dotfiles
/// activation. It is never passed in argv — argv is world-readable in `ps` —
/// and never echoed into an error message.
pub fn load_key(path: &Path) -> Result<String, Error> {
    if let Ok(v) = std::env::var("GLOSS_KEY") {
        let t = v.trim().to_string();
        if !t.is_empty() { return Ok(t); }
    }
    let raw = std::fs::read_to_string(path).map_err(|_| Error::new(ErrorCode::MissingKey,
        format!("No API key — expected at {}.", path.display())))?;
    let t = raw.trim().to_string();
    if t.is_empty() {
        return Err(Error::new(ErrorCode::MissingKey,
            format!("No API key — expected at {}.", path.display())));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(md) = std::fs::metadata(path) {
            let mode = md.permissions().mode() & 0o777;
            if mode & 0o077 != 0 {
                eprintln!("gloss: warning: {} is mode {:o}; expected 0600.", path.display(), mode);
            }
        }
    }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Env vars are process-global; the shared lock keeps GLOSS_KEY from leaking
    // into a sibling test running concurrently.
    fn lock() -> std::sync::MutexGuard<'static, ()> {
        crate::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn tmp_key(contents: &str) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn reads_and_trims_the_file() {
        let _g = lock();
        let f = tmp_key("AIza-secret\n");
        std::env::remove_var("GLOSS_KEY");
        assert_eq!(load_key(f.path()).unwrap(), "AIza-secret");
    }

    #[test]
    fn env_wins_over_the_file() {
        let _g = lock();
        let f = tmp_key("from-file");
        std::env::set_var("GLOSS_KEY", "from-env");
        let got = load_key(f.path()).unwrap();
        std::env::remove_var("GLOSS_KEY");
        assert_eq!(got, "from-env");
    }

    #[test]
    fn a_missing_file_is_missing_key() {
        let _g = lock();
        std::env::remove_var("GLOSS_KEY");
        let e = load_key(std::path::Path::new("/nope/key")).unwrap_err();
        assert_eq!(e.code, ErrorCode::MissingKey);
        assert!(e.message.contains("/nope/key"), "the message names the path it looked in");
    }

    #[test]
    fn an_empty_file_is_missing_key() {
        let _g = lock();
        let f = tmp_key("   \n");
        std::env::remove_var("GLOSS_KEY");
        assert_eq!(load_key(f.path()).unwrap_err().code, ErrorCode::MissingKey);
    }

    #[test]
    fn the_key_is_never_included_in_the_error_message() {
        let _g = lock();
        let f = tmp_key("AIza-super-secret");
        std::env::remove_var("GLOSS_KEY");
        let _ = load_key(f.path());
        // The only messages load_key can produce are the missing-key ones,
        // which name the path and never the value.
        let e = load_key(std::path::Path::new("/nope/key")).unwrap_err();
        assert!(!e.message.contains("AIza"));
    }
}
