use anchor_lang::prelude::*;

#[account]
pub struct ClearingState {
    pub authority: Pubkey,
    pub total_sessions: u64,
    pub fee_rate_bps: u64,
    pub update_timestamp: i64,
    pub bump: u8,
}

impl ClearingState {
    pub const LEN: usize = 8 + // descriminator
        32 + // authority
        8 + // total_sessions
        8 + // fee_rate_bps
        8 + // update_timestamp
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"state"], &crate::ID)
    }

    pub fn get_next_session_id(&self) -> u64 {
        self.total_sessions + 1
    }

    pub fn inc_sessions(&mut self) {
        self.total_sessions += 1;
    }

    pub fn fee_rate_as_percent(&self) -> f64 {
        self.fee_rate_bps as f64 / 100.0
    }

    pub fn calculate_fee(&self, amount: u64) -> u64 {
        amount * self.fee_rate_bps / 10000
    }
}
