use std::fmt::Display;

use crate::models::*;
use actix_web::{http::StatusCode, HttpResponse};
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{self, Deserialize, Serialize};
use sqlx::PgPool;

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
                    | "request_withdrawal"
                    | "view_withdrawals"
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

/// Получает роль пользователя по адресу
pub async fn get_user_role(pool: &PgPool, address: &str) -> Result<UserRole, sqlx::Error> {
    let participant = sqlx::query_as::<_, Participant>(
        "SELECT * FROM participants WHERE address = $1 AND is_active = true",
    )
    .bind(address)
    .fetch_optional(pool)
    .await?;

    match participant {
        Some(p) => UserRole::from_str(&p.user_type).ok_or(sqlx::Error::RowNotFound),
        None => Ok(UserRole::Guest), // Если пользователь не найден, считаем его гостем
    }
}

/// Проверяет, имеет ли пользователь разрешение на действие
pub async fn check_permission(
    pool: &PgPool,
    address: &str,
    action: &str,
) -> Result<bool, sqlx::Error> {
    let role = get_user_role(pool, address).await?;
    Ok(role.has_permission(action))
}

/// Middleware для проверки авторизации
pub async fn require_auth(pool: &PgPool, address: &str, action: &str) -> Result<(), HttpResponse> {
    match check_permission(pool, address, action).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(HttpResponse::build(StatusCode::FORBIDDEN).json(
            ApiResponse::<String>::error("Insufficient permissions".to_string()),
        )),
        Err(_) => {
            Err(HttpResponse::build(StatusCode::INTERNAL_SERVER_ERROR).json(
                ApiResponse::<String>::error("Authorization check failed".to_string()),
            ))
        }
    }
}

/// Регистрирует нового пользователя с ролью Guest
pub async fn register_guest(pool: &PgPool, address: &str) -> Result<Participant, sqlx::Error> {
    sqlx::query_as::<_, Participant>(
        r#"
        INSERT INTO participants (address, user_type, is_active, balance)
        VALUES ($1, 'guest', true, 0)
        ON CONFLICT (address) DO UPDATE SET
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(address)
    .fetch_one(pool)
    .await
}

/// Обновляет роль пользователя
pub async fn update_user_role(
    pool: &PgPool,
    address: &str,
    new_role: &UserRole,
) -> Result<Participant, sqlx::Error> {
    sqlx::query_as::<_, Participant>(
        "UPDATE participants SET user_type = $1, updated_at = NOW() WHERE address = $2 RETURNING *",
    )
    .bind(new_role.to_string())
    .bind(address)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}

/// Деактивирует пользователя
pub async fn deactivate_user(pool: &PgPool, address: &str) -> Result<Participant, sqlx::Error> {
    sqlx::query_as::<_, Participant>(
        "UPDATE participants SET is_active = false, updated_at = NOW() WHERE address = $1 RETURNING *",
    )
    .bind(address)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}

/// Активирует пользователя
pub async fn activate_user(pool: &PgPool, address: &str) -> Result<Participant, sqlx::Error> {
    sqlx::query_as::<_, Participant>(
        "UPDATE participants SET is_active = true, updated_at = NOW() WHERE address = $1 RETURNING *",
    )
    .bind(address)
    .fetch_optional(pool)
    .await?
    .ok_or(sqlx::Error::RowNotFound)
}
