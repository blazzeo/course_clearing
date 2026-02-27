use anchor_lang::prelude::*;

#[event]
pub struct FeePaid {
    pub participant: Pubkey,
    pub session_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeWithdrawed {
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeRateUpdated {
    pub admin: Pubkey,
    pub old_rate: u64,
    pub new_rate: u64,
    pub timestamp: i64,
}
