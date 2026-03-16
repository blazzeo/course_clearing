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

    let verifying_key = match VerifyingKey::from_bytes(&public_key_bytes.try_into().unwrap()) {
        Ok(pk) => pk,
        Err(_) => return false,
    };

    let signature = Signature::from_bytes(&signature_bytes.try_into().unwrap());

    verifying_key.verify(message.as_bytes(), &signature).is_ok()
}
