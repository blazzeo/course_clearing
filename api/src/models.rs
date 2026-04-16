use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow, PartialEq)]
pub struct RawSettlement {
    pub from_address: Pubkey,
    pub to_address: Pubkey,
    pub amount: u64,
}

#[derive(Deserialize)]
pub struct AdminSignedRequest {
    pub message: String,
    pub signature: String,
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub timestamp: Option<i64>,
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

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct DbObligationRecord {
    pub pda: String,
    pub from_address: String,
    pub to_address: String,
    pub original_amount: i64,
    pub remaining_amount: i64,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct DbClearingSessionRow {
    pub session_id: i64,
    pub result_id: String,
    pub result_hash: String,
    pub merkle_root: String,
    pub external_count: i32,
    pub internal_count: i32,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct DbParticipantRecord {
    pub pda: String,
    pub authority: String,
    pub user_name: String,
}
