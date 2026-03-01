use anchor_lang::prelude::*;

/// Account for getting commissions from users of system
/// Only admin can create this account (he is the owner)
#[account]
pub struct Escrow {
    pub authority: Pubkey,
    pub total_fees: u64,
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + // descriminator
        32 + // authority
        8 + // total_fess
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"escrow"], &crate::ID)
    }
}
