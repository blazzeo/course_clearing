use anchor_lang::prelude::*;

#[account]
pub struct NetPosition {
    pub session_id: u64,
    pub participant: Pubkey,
    pub net_amount: i64,
    pub bump: u8,
}

impl NetPosition {
    pub const LEN: usize = std::mem::size_of::<Self>();
}
