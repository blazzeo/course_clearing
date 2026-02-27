use anchor_lang::prelude::*;

#[event]
pub struct EscrowInitialized {
    pub admin: Pubkey,
    pub escrow: Pubkey,
    pub timestamp: i64,
}
