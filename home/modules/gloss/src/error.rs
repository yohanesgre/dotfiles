use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    EmptyInput, OverCap, MissingKey, BadKey, BadRequest,
    QuotaExhausted, RateLimited, Timeout, Network, Upstream, BadOutput,
}

impl ErrorCode {
    pub const ALL: [ErrorCode; 11] = [
        ErrorCode::EmptyInput, ErrorCode::OverCap, ErrorCode::MissingKey,
        ErrorCode::BadKey, ErrorCode::BadRequest, ErrorCode::QuotaExhausted,
        ErrorCode::RateLimited, ErrorCode::Timeout, ErrorCode::Network,
        ErrorCode::Upstream, ErrorCode::BadOutput,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::EmptyInput => "empty_input",
            ErrorCode::OverCap => "over_cap",
            ErrorCode::MissingKey => "missing_key",
            ErrorCode::BadKey => "bad_key",
            ErrorCode::BadRequest => "bad_request",
            ErrorCode::QuotaExhausted => "quota_exhausted",
            ErrorCode::RateLimited => "rate_limited",
            ErrorCode::Timeout => "timeout",
            ErrorCode::Network => "network",
            ErrorCode::Upstream => "upstream",
            ErrorCode::BadOutput => "bad_output",
        }
    }

    /// Retryable = worth sending the identical request again.
    /// Retrying a rejected key, a malformed request, or an exhausted daily
    /// quota cannot succeed, so the widget renders no Retry control for those.
    pub fn is_retryable(self) -> bool {
        matches!(self, ErrorCode::RateLimited | ErrorCode::Timeout
                   | ErrorCode::Network | ErrorCode::Upstream | ErrorCode::BadOutput)
    }
}

#[derive(Debug)]
pub struct Error {
    pub code: ErrorCode,
    pub message: String,
    pub retry_after: Option<u64>,
}

impl Error {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Error { code, message: message.into(), retry_after: None }
    }
    pub fn with_retry(mut self, secs: u64) -> Self { self.retry_after = Some(secs); self }
}
