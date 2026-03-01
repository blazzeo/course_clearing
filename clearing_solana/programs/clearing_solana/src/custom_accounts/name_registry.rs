use anchor_lang::prelude::*;

/// Account for saving users' names,
/// uses can occupy name, so next will see it is used
#[account]
pub struct NameRegistry {
    pub name_bytes: [u8; 32],
    pub participant: Pubkey,
    pub bump: u8,
}

impl NameRegistry {
    pub const LEN: usize = 8 + // delimiter
            32 + // name_bytes
            32 + // participant
            1; // bump

    pub fn pda_by_name(name: &str) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"name_registry", name.as_bytes()], &crate::ID)
    }
}
