use gloss::cache::Cache;
use gloss::card::Card;
use gloss::lang::LanguageOverrides;
use gloss::{config, key};
use gloss::lookup::{emit, lookup, LookupRequest};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut cfg = config::load_config(config::default_path().as_deref());

    match args.first().map(String::as_str) {
        Some("lookup") => {
            let mut text = String::new();
            let mut dry_run = false;
            let mut refresh = false;
            // `--source`/`--target`/`--explain-in` for this invocation only.
            // Each value is validated against the language allow-list before it
            // is used — the flags are untrusted input (a shell built the command
            // that carried them).
            let mut langs = LanguageOverrides::default();
            let mut i = 1;
            while i < args.len() {
                match args[i].as_str() {
                    "--b64" => {
                        let b64 = args.get(i + 1).cloned().unwrap_or_default();
                        text = gloss::base64::decode(&b64)
                            .and_then(|b| String::from_utf8(b).ok())
                            .unwrap_or_default();
                        i += 2;
                    }
                    "--selection" => {
                        // The CLI reads the selection itself, so the text never
                        // enters the widget and never becomes part of a shell
                        // command.
                        text = std::process::Command::new("wl-paste")
                            .args(["--primary", "--no-newline"])
                            .output()
                            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                            .unwrap_or_default();
                        i += 1;
                    }
                    "--dry-run" => { dry_run = true; i += 1; }
                    // Re-roll: skip the cache read, still write the fresh answer.
                    "--refresh" => { refresh = true; i += 1; }
                    "--source" | "--target" | "--explain-in" => {
                        let flag = args[i].clone();
                        let value = args.get(i + 1).cloned().unwrap_or_default();
                        match gloss::lang::validate_language(&value) {
                            Ok(code) => match flag.as_str() {
                                "--source" => langs.source = Some(code),
                                "--target" => langs.target = Some(code),
                                _ => langs.explain_in = Some(code),
                            },
                            // A malformed code is refused before anything else: it
                            // must never reach a request (or a shell).
                            Err(e) => { emit(&Card::error(&e)); return; }
                        }
                        i += 2;
                    }
                    other => {
                        match gloss::input::read_input(std::path::Path::new(other), cfg.cap) {
                            Ok(t) => text = t,
                            Err(e) => { emit(&Card::error(&e)); return; }
                        }
                        i += 1;
                    }
                }
            }
            if dry_run { println!("{text}"); return; }
            langs.apply(&mut cfg);
            let api_key = key::load_key(&cfg.key_path).unwrap_or_default();
            let cache = Cache::open(&cfg.cache_path);
            let req = LookupRequest { text, key: api_key, config: cfg, refresh };
            emit(&lookup(&req, &real_transport(), &cache));
        }
        Some("cache") => {
            let cache = Cache::open(&cfg.cache_path);
            match args.get(1).map(String::as_str) {
                Some("--stats") => {
                    let s = cache.stats();
                    println!("entries: {}\nbytes:   {}", s.entries, s.bytes);
                }
                Some("--clear") => {
                    if let Err(e) = cache.clear() {
                        emit(&Card::error(&e));
                    } else {
                        println!("cache cleared");
                    }
                }
                _ => eprintln!("usage: gloss cache --stats | --clear"),
            }
        }
        _ => eprintln!("usage: gloss lookup <file> | gloss lookup --b64 <b64> \
                        | gloss lookup --selection | gloss lookup --refresh \
                        | gloss lookup [--source <code|auto>] [--target <code>] \
                        [--explain-in <code>] \
                        | gloss cache --stats | gloss cache --clear"),
    }
}

fn real_transport() -> impl gloss::gemini::Transport {
    gloss::gemini::UreqTransport::new()
}
