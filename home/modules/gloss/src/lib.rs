pub mod base64;
pub mod card;
pub mod cache;
pub mod config;
pub mod error;
pub mod gemini;
pub mod input;
pub mod key;
pub mod lang;
pub mod lookup;

/// Env vars are process-global, so every test that mutates one takes this one
/// lock. Shared here so the config and key test modules cannot drift apart.
#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
