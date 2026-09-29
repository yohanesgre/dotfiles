//! Standard-alphabet base64 (RFC 4648 §4), used so a selection can be handed
//! to the CLI as a single argv entry with no shell metacharacters in it. Both
//! padded and unpadded input are accepted; malformed input is rejected rather
//! than decoded into garbage.

const ALPHABET: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn value(c: u8) -> Option<u32> {
    match c {
        b'A'..=b'Z' => Some(u32::from(c - b'A')),
        b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes standard base64. Returns `None` for anything malformed: a length of
/// `1` mod 4, a character outside the alphabet (including whitespace and `-`/`_`
/// from the URL-safe alphabet), padding in a non-final position, padding that
/// does not complete its four-character group (`QQ=` but not `QQ==`), a group
/// with fewer than two data characters (`Q=` cannot encode a whole byte), or a
/// final chunk with more than two `=`.
pub fn decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if bytes.len() % 4 == 1 {
        return None;
    }
    let chunks: Vec<&[u8]> = bytes.chunks(4).collect();
    let last = chunks.len().wrapping_sub(1);
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3 + 2);
    for (i, chunk) in chunks.iter().enumerate() {
        let data = chunk.iter().filter(|&&c| c != b'=').count();
        let pad = chunk.len() - data;
        // Padding only ever terminates the whole input, at most two of it, and
        // it must complete a four-character group: `QQ==` is valid, `QQ=` is
        // not. A lone data char (6 bits) cannot encode a whole byte, so `Q=`
        // and `Q==` are rejected rather than decoded into a garbage byte.
        if pad > 0 && i != last {
            return None;
        }
        if pad > 2 || data < 2 || (pad > 0 && chunk.len() != 4) {
            return None;
        }
        // Everything before the padding must be data; `=` may not appear early.
        if chunk[..data].contains(&b'=') {
            return None;
        }
        let mut n = 0u32;
        for &c in &chunk[..data] {
            n = (n << 6) | value(c)?;
        }
        // Left-align the `data * 6` bits into a full 24-bit group so the output
        // byte extraction below is independent of how many padding chars there were.
        n <<= 6 * (4 - data as u32);
        out.push((n >> 16) as u8);
        if data >= 3 {
            out.push((n >> 8) as u8);
        }
        if data >= 4 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// Encodes to standard padded base64.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(s: &str) {
        let encoded = encode(s.as_bytes());
        assert_eq!(decode(&encoded).as_deref(), Some(s.as_bytes()), "encoding {s:?}");
    }

    #[test]
    fn round_trips_ascii() {
        round_trip("nevertheless");
        round_trip("meskipun demikian, namun");
        round_trip("a");
        round_trip("ab");
        round_trip("abc");
    }

    #[test]
    fn round_trips_non_ascii() {
        round_trip("uang — bisa? 👍");
    }

    #[test]
    fn round_trips_empty() {
        assert_eq!(decode(""), Some(Vec::new()));
        assert_eq!(encode(b""), "");
    }

    #[test]
    fn padres_and_unpadded_2_and_3_char_forms_decode() {
        // Padded and unpadded forms of the same bytes must agree, and none of
        // these may hang.
        assert_eq!(decode("QQ").as_deref(), Some(b"A".as_slice()));
        assert_eq!(decode("QQ==").as_deref(), Some(b"A".as_slice()));
        assert_eq!(decode("QUJ").as_deref(), Some(b"AB".as_slice()));
        assert_eq!(decode("QUJ=").as_deref(), Some(b"AB".as_slice()));
    }

    #[test]
    fn a_length_of_one_mod_four_is_rejected() {
        // Every residue must return; 1 is not a valid base64 length.
        for s in ["Q", "QUJDQ", "Q===", "QUJDQQ==Q"] {
            assert_eq!(decode(s), None, "{s:?}");
        }
    }

    #[test]
    fn invalid_characters_are_rejected() {
        for s in ["Q!", "QU\nJ", "QUJ-", "QUJ_", "Q Q", "****"] {
            assert_eq!(decode(s), None, "{s:?}");
        }
    }

    #[test]
    fn padding_in_a_non_final_position_is_rejected() {
        // Previously this decoded to the garbage byte @\x04 instead of None.
        assert_eq!(decode("Q=QQ"), None);
        assert_eq!(decode("QQ==QQ=="), None);
        assert_eq!(decode("="), None);
    }

    #[test]
    fn more_than_two_padding_chars_is_rejected() {
        assert_eq!(decode("Q==="), None);
        assert_eq!(decode("QQ===="), None);
    }

    #[test]
    fn a_lone_data_char_or_a_short_padded_group_is_rejected() {
        // A single data char is 6 bits: `Q=`/`Q==` used to decode to `@`.
        // `QQ=` has two data chars but only one pad — the group must be `QQ==`.
        for s in ["Q=", "Q==", "QQ="] {
            assert_eq!(decode(s), None, "{s:?}");
        }
    }

    #[test]
    fn known_vectors() {
        assert_eq!(encode(b"AB"), "QUI=");
        assert_eq!(decode("QUI=").as_deref(), Some(b"AB".as_slice()));
        assert_eq!(encode(b"Hello, world"), "SGVsbG8sIHdvcmxk");
        assert_eq!(decode("SGVsbG8sIHdvcmxk").as_deref(), Some(b"Hello, world".as_slice()));
    }
}
