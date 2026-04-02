use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow, PartialEq)]
pub struct RawSettlement {
    pub from_address: Pubkey,
    pub to_address: Pubkey,
    pub amount: i64,
}

#[derive(Deserialize)]
pub struct AdminSignedRequest {
    pub message: String,
    pub signature: String,
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
