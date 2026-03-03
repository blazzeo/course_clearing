use anchor_lang::prelude::*;

/// Object of session, maily used for statistics
#[account]
pub struct ClearingSession {
    pub id: u64,
    pub status: ClearingSessionStatus,
    pub opened_at: i64,
    pub closed_at: i64,
    pub total_obligations: u32,
    pub processed_count: u32,
    pub bump: u8,
}

impl ClearingSession {
    pub const LEN: usize = std::mem::size_of::<Self>();

    pub fn pda(session_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"session", &session_id.to_le_bytes()], &crate::ID)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ClearingSessionStatus {
    Open,
    Closed,
    Cancelled,
    Failed,
}
