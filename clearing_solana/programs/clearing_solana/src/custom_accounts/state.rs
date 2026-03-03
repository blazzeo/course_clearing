use anchor_lang::prelude::*;

/// Account for general state of system
#[account]
pub struct ClearingState {
    pub authority: Pubkey,
    pub total_sessions: u64,
    pub total_participants: u64,
    pub total_obligations: u64,
    pub fee_rate_bps: u64,
    pub update_timestamp: i64,
    pub bump: u8,
}

impl ClearingState {
    pub const LEN: usize = std::mem::size_of::<Self>();

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"state"], &crate::ID)
    }

    pub fn fee_rate_as_percent(&self) -> f64 {
        self.fee_rate_bps as f64 / 100.0
    }

    pub fn calculate_fee(&self, amount: u64) -> u64 {
        amount * self.fee_rate_bps / 10000
    }
}
