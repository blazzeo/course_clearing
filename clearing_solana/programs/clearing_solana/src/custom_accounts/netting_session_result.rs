use anchor_lang::prelude::*;

/// Result of netting sessions
#[account]
pub struct NettingSessionResult {
    pub id: u64,
    pub session_id: u64,
    pub amount: u64,
    pub counter_agent: Pubkey,
}
