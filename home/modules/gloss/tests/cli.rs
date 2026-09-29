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
