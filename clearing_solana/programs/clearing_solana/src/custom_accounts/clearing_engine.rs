use anchor_lang::prelude::*;

#[account]
pub struct ClearingEngine {
    pub authority: Pubkey,
    // pub state: Pubkey, // ClearingState
    pub bump: u8,
}

impl ClearingEngine {
    pub const LEN: usize = 8 + // descriminator
        32 + // authority
        // 32 + // ClearingState
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"engine"], &crate::ID)
    }
}

#[error_code]
pub enum ClearingEngineError {
    #[msg("Unauthorized")]
    Unauthorized,
}
