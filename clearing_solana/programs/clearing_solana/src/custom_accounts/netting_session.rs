use anchor_lang::prelude::*;

#[account]
pub struct NettingSession {
    pub session_id: u64,
    pub status: NettingSessionStatus,
    pub opened_at: i64,
    pub closed_at: i64,
    pub participant_count: u32,
    pub obligation_count: u32,
    pub bump: u8,
}

impl NettingSession {
    pub const LEN: usize = 8 + // descriminator
        8 + // session_id
        1 + // status
        8 + // opened_at
        8 + // closed_at
        4 + // participant_count
        4 + // obligation_count
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum NettingSessionStatus {
    Open,
    Closed,
    Cancelled,
}
