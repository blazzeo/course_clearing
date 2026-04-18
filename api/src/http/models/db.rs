//! Строки таблиц Postgres, маппящиеся через sqlx.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct DbObligationRecord {
    pub pda: String,
    pub from_address: String,
    pub to_address: String,
    pub original_amount: i64,
    pub remaining_amount: i64,
    pub expecting_operational_day: i64,
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
