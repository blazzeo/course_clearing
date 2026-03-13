use std::fmt::Display;

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{self, Deserialize, Serialize};

/// Перечисление ролей пользователей
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Guest,
    Counterparty,
    Auditor,
    Administrator,
}

impl Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            UserRole::Guest => "guest",
            UserRole::Counterparty => "counterparty",
            UserRole::Auditor => "auditor",
            UserRole::Administrator => "administrator",
        })
    }
}

impl UserRole {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "guest" => Some(UserRole::Guest),
            "counterparty" => Some(UserRole::Counterparty),
            "auditor" => Some(UserRole::Auditor),
            "administrator" => Some(UserRole::Administrator),
            _ => None,
        }
    }

    /// Проверяет, имеет ли роль доступ к определенному действию
    pub fn has_permission(&self, action: &str) -> bool {
        match self {
            UserRole::Guest => matches!(action, "view_public_info" | "register" | "authenticate"),
            UserRole::Counterparty => matches!(
                action,
                "view_public_info"
                    | "register"
                    | "authenticate"
                    | "create_position"
                    | "cancel_position"
                    | "view_own_positions"
                    | "update_profile"
                    | "deposit_funds"
            ),
            UserRole::Auditor => matches!(
                action,
                "view_public_info"
                    | "register"
                    | "authenticate"
                    | "view_all_positions"
                    | "view_balances"
                    | "audit_system"
            ),
            UserRole::Administrator => true, // Администраторы имеют все права
        }
    }
}

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
