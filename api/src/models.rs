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

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePositionRequest {
    pub wallet: String,
    pub payload: Payload,
    pub signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterParticipantRequest {
    pub address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateUserTypeRequest {
    pub address: String,
    pub user_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfirmPositionRequest {
    pub wallet: String,
    pub position_id: i32,
    pub timestamp: i64,
    pub signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Payload {
    pub counterparty: String,
    pub amount_lamports: u64,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatePositionRequest {
    pub amount: Option<i64>,
    pub status: Option<String>,
    pub wallet: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Participant {
    pub address: String,
    pub user_type: String,
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub is_active: bool,
    pub balance: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

// #[derive(Debug, Serialize, Deserialize, FromRow)]
// pub struct Invoice {
//     pub id: i32,
//     pub address: String,
//     pub amount: i64,
//     pub created_at: DateTime<Utc>,
//     pub paid: bool,
// }

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Settlement {
    pub id: i32,
    pub session_id: i32,
    pub from_address: String,
    pub to_address: String,
    pub amount: i64,
    pub tx_signature: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow, PartialEq)]
pub struct RawSettlement {
    pub from_address: String,
    pub to_address: String,
    pub amount: i64,
}

#[derive(Deserialize)]
pub struct PayRequest {
    pub tx_signature: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SystemSetting {
    pub id: i32,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: i32,
    pub user_address: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub old_values: Option<serde_json::Value>,
    pub new_values: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSystemSettingsRequest {
    pub key: String,
    pub value: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeactivateParticipantRequest {
    pub address: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DepositFundsRequest {
    pub amount: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Withdrawal {
    pub id: i32,
    pub participant: String,
    pub amount: i64,
    pub status: String,
    pub requested_at: DateTime<Utc>,
    pub approved_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub tx_signature: Option<String>,
    pub nonce: Option<i64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct WithdrawalParticipant {
    pub id: i32,
    pub amount: i64,
    pub status: String,
    pub nonce: Option<i64>,
    pub requested_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApproveWithdrawalRequest {
    pub withdrawal_address: String,
    pub withdrawal_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompleteWithdrawalRequest {
    pub withdrawal_address: String,
    pub tx_signature: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlockchainBalanceResponse {
    pub blockchain_balance: u64,
    pub contract_balance: Option<i64>,
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
