//! Host keys: the secret a host presents to reclaim its share id after a drop. The key is an
//! HMAC of the id under a relay secret, so the relay can rebuild it after a restart without
//! storing anything.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

fn mac(secret: &[u8], id: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(id.as_bytes());
    mac
}

/// Lowercase hex HMAC-SHA256(secret, id): 64 characters.
pub fn host_key(secret: &[u8], id: &str) -> String {
    mac(secret, id)
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.is_ascii() {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Constant-time check that `key` is the host key for `id`.
pub fn verify(secret: &[u8], id: &str, key: &str) -> bool {
    match unhex(key) {
        Some(bytes) => mac(secret, id).verify_slice(&bytes).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_keys_are_stable_and_secret_bound() {
        let k = host_key(b"secret", "brisk-otter-lantern");
        assert_eq!(k.len(), 64);
        assert!(
            k.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_eq!(k, host_key(b"secret", "brisk-otter-lantern"));
        assert_ne!(k, host_key(b"other", "brisk-otter-lantern"));
        assert_ne!(k, host_key(b"secret", "brisk-otter-lamp"));
        assert!(verify(b"secret", "brisk-otter-lantern", &k));
        assert!(!verify(b"other", "brisk-otter-lantern", &k));
        assert!(!verify(b"secret", "brisk-otter-lamp", &k));
        assert!(!verify(b"secret", "brisk-otter-lantern", &k[..63]));
        assert!(!verify(b"secret", "brisk-otter-lantern", ""));
        assert!(!verify(b"secret", "brisk-otter-lantern", &"z".repeat(64)));
    }
}
