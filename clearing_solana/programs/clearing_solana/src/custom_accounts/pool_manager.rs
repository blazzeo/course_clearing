use anchor_lang::prelude::*;

#[account]
pub struct PoolManager {
    pub authority: Pubkey,
    pub root_pool: Pubkey,
    pub bump: u8,
}

impl PoolManager {
    pub const LEN: usize = 8 + // descriminator
        32 + // authority
        32 + // root_pool
        1; // bump
}
