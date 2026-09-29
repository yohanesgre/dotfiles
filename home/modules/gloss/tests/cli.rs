use gloss::base64::encode;
use std::process::Command;

fn bin() -> std::path::PathBuf {
    let mut p = std::env::current_exe().unwrap();
    p.pop(); p.pop();
    p.join("gloss")
}

#[test]
fn b64_round_trips_ascii_and_non_ascii() {
    for text in ["nevertheless", "meskipun demikian, namun", "uang — bisa? 👍"] {
        let b64 = encode(text.as_bytes());
        let out = Command::new(bin()).args(["lookup", "--b64", &b64, "--dry-run"])
            .output().unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(stdout.contains(text), "--dry-run must echo the decoded text");
    }
}

#[test]
fn a_shell_metacharacter_payload_is_not_executed() {
    // If the text were interpolated into a shell, this would create a file.
    let payload = "x'; touch /tmp/gloss-pwned; echo '";
    let b64 = encode(payload.as_bytes());
    let _ = Command::new(bin()).args(["lookup", "--b64", &b64, "--dry-run"]).output().unwrap();
    assert!(!std::path::Path::new("/tmp/gloss-pwned").exists(),
            "the payload must be treated as text, never executed");
}

#[test]
fn the_production_encoder_is_shell_safe_for_hostile_input() {
    // Asserted against the PRODUCTION encoder, not a test-local copy: if the
    // real encoder ever emitted `;` or `$(...)` this must fail.
    let hostile = [
        "x'; touch /tmp/gloss-pwned; echo '",
        "`id`",
        "$(id)",
        "a\nb\r\nc",
        "back\\slash \"double\" 'single'",
        "uang — bisa? 👍",
        "",
        "\u{0000}\u{001b}[31m",
    ];
    for payload in hostile {
        let b64 = encode(payload.as_bytes());
        assert!(b64.chars().all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c)),
                "base64 output must contain no shell metacharacters: {b64:?}");
    }
}

fn dry_run(args: &[&str]) -> String {
    let out = Command::new(bin()).args(args).output().unwrap();
    String::from_utf8_lossy(&out.stdout).to_string()
}

#[test]
fn language_flags_are_accepted_and_do_not_block_the_dry_run() {
    let b64 = encode(b"nevertheless");
    let stdout = dry_run(&["lookup", "--b64", &b64,
                           "--source", "en", "--target", "id", "--dry-run"]);
    assert!(stdout.contains("nevertheless"), "--dry-run must echo the text: {stdout:?}");
    assert!(!stdout.contains("\"kind\":\"error\""), "valid flags must not error: {stdout:?}");
}

#[test]
fn source_auto_passes_through_the_flag() {
    let b64 = encode(b"uang");
    let stdout = dry_run(&["lookup", "--b64", &b64,
                           "--source", "auto", "--target", "id", "--explain-in", "id", "--dry-run"]);
    assert!(stdout.contains("uang"), "{stdout:?}");
    assert!(!stdout.contains("\"kind\":\"error\""), "`auto` is a valid source: {stdout:?}");
}

#[test]
fn a_hostile_language_value_is_rejected_and_never_reaches_a_shell() {
    // The widget appends language values to a command the Plasma exec engine
    // runs through a shell. A value that is not a language code must be refused
    // by the CLI — the defence-in-depth backstop behind the widget's allow-list.
    let pwned = std::path::Path::new("/tmp/gloss-pwned");
    let _ = std::fs::remove_file(pwned);
    let b64 = encode(b"nevertheless");
    let stdout = dry_run(&["lookup", "--b64", &b64,
                           "--source", "en; touch /tmp/gloss-pwned", "--dry-run"]);
    assert!(stdout.contains("\"kind\":\"error\""), "a hostile language must be rejected: {stdout:?}");
    assert!(stdout.contains("bad_request"), "rejected as a bad request: {stdout:?}");
    assert!(!pwned.exists(), "the language value must never reach a shell");
}

#[test]
fn a_regioned_code_is_accepted() {
    let b64 = encode(b"nevertheless");
    let stdout = dry_run(&["lookup", "--b64", &b64, "--source", "pt-BR", "--dry-run"]);
    assert!(stdout.contains("nevertheless"), "{stdout:?}");
    assert!(!stdout.contains("\"kind\":\"error\""), "{stdout:?}");
}
