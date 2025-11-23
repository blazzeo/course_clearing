use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Position {
    pub id: i64,
    pub creator_address: String,
    pub counterparty_address: String,
    pub amount: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub cleared_at: Option<DateTime<Utc>>,
    pub transaction_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePositionRequest {
    pub counterparty_address: String,
    pub amount: i64,
    pub signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatePositionRequest {
    pub amount: Option<i64>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Participant {
    pub id: i64,
    pub address: String,
    pub balance: i64,
    pub margin: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MultiPartyClearingRequest {
    pub participants: Vec<String>,
    pub amounts: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MarginRequest {
    pub amount: u64,
    pub signature: Option<String>,
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




