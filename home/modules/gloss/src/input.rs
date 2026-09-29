use crate::error::{Error, ErrorCode};
use std::path::Path;
use unicode_segmentation::UnicodeSegmentation;

/// The single home for the trim / empty / grapheme-cap rule. Every caller —
/// the CLI's file path and the lookup core alike — goes through this so the
/// cap message cannot drift between them.
pub fn validate(text: &str, cap: usize) -> Result<String, Error> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(Error::new(ErrorCode::EmptyInput,
            "Nothing to look up — the selection was empty."));
    }
    let n = text.graphemes(true).count();
    if n > cap {
        return Err(Error::new(ErrorCode::OverCap, format!(
            "{n} / {cap} — trim it to look up. Nothing was sent."
        )));
    }
    Ok(text)
}

/// Reads the selection from a file. The text arrives as a path, never as an
/// argument, so it can never reach a shell.
pub fn read_input(path: &Path, cap: usize) -> Result<String, Error> {
    let raw = std::fs::read_to_string(path).map_err(|_| {
        Error::new(ErrorCode::EmptyInput, "Nothing to look up — the selection was empty.")
    })?;
    validate(&raw, cap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(contents: &str) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn reads_and_trims() {
        let f = tmp("  nevertheless \n");
        assert_eq!(read_input(f.path(), 1000).unwrap(), "nevertheless");
    }

    #[test]
    fn whitespace_only_is_empty_input() {
        let f = tmp("   \n\t ");
        assert_eq!(read_input(f.path(), 1000).unwrap_err().code, ErrorCode::EmptyInput);
    }

    #[test]
    fn missing_file_is_empty_input() {
        let e = read_input(std::path::Path::new("/nope/x.txt"), 1000).unwrap_err();
        assert_eq!(e.code, ErrorCode::EmptyInput);
    }

    #[test]
    fn over_cap_is_refused_never_truncated() {
        let f = tmp(&"a".repeat(1001));
        let e = read_input(f.path(), 1000).unwrap_err();
        assert_eq!(e.code, ErrorCode::OverCap);
        assert!(e.message.contains("1001"), "the message names the actual count");
    }

    #[test]
    fn cap_counts_graphemes_not_bytes() {
        // 500 emoji = 500 graphemes but 2000 bytes. Must pass a 1000 cap.
        let f = tmp(&"👍".repeat(500));
        assert_eq!(read_input(f.path(), 1000).unwrap().chars().count(), 500);
    }

    #[test]
    fn cap_counts_graphemes_not_chars() {
        // "e\u{0301}" is 2 chars but a single grapheme — 500 emoji are 500 of
        // both, so only this case distinguishes the two.
        assert_eq!(validate("e\u{0301}", 1).unwrap(), "e\u{0301}");
        assert_eq!(validate("e\u{0301}e\u{0301}", 1).unwrap_err().code, ErrorCode::OverCap);
    }

    #[test]
    fn exactly_at_cap_is_allowed() {
        let f = tmp(&"a".repeat(1000));
        assert_eq!(read_input(f.path(), 1000).unwrap().len(), 1000);
    }

    #[test]
    fn validate_is_the_shared_rule_for_trim_empty_and_cap() {
        assert_eq!(validate("  nevertheless \n", 1000).unwrap(), "nevertheless");
        assert_eq!(validate("   \n\t ", 1000).unwrap_err().code, ErrorCode::EmptyInput);
        let e = validate(&"a".repeat(1001), 1000).unwrap_err();
        assert_eq!(e.code, ErrorCode::OverCap);
        assert_eq!(e.message, "1001 / 1000 — trim it to look up. Nothing was sent.");
    }
}
