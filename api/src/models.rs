use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Position {
    pub id: i32,
    pub creator_address: String,
    pub counterparty_address: String,
    pub amount: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub cleared_at: Option<DateTime<Utc>>,
    pub creator_signature: Option<String>,
    pub counterparty_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow, PartialEq)]
pub struct RawSettlement {
    pub from_address: String,
    pub to_address: String,
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}
