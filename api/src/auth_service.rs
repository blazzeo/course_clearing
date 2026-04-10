use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Проверяет подпись Solana
pub fn verify(public_key: &str, message: &str, signature: &str) -> bool {
    let public_key_bytes = match bs58::decode(public_key).into_vec() {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    let signature_bytes = match general_purpose::STANDARD.decode(signature) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    let public_key_arr: [u8; 32] = match public_key_bytes.as_slice().try_into() {
        Ok(arr) => arr,
        Err(_) => return false,
    };
    let signature_arr: [u8; 64] = match signature_bytes.as_slice().try_into() {
        Ok(arr) => arr,
        Err(_) => return false,
    };

    let verifying_key = match VerifyingKey::from_bytes(&public_key_arr) {
        Ok(pk) => pk,
        Err(_) => return false,
    };

    let signature = Signature::from_bytes(&signature_arr);

    verifying_key.verify(message.as_bytes(), &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::verify;

    #[test]
    fn verify_rejects_invalid_key_and_signature_sizes() {
        let ok = verify("abc", "clear", "Zm9v");
        assert!(!ok);
    }
}
