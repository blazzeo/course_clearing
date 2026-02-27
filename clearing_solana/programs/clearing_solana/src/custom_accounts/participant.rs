use anchor_lang::prelude::*;

#[account]
pub struct Participant {
    pub authority: Pubkey,
    pub user_type: UserType,
    pub user_name: [u8; 32],
    pub user_name_len: u8,
    pub registration_timestamp: i64,
    pub update_timestamp: i64,
    pub last_session_id: u64,
    pub name_registry: Pubkey,
    pub bump: u8,
}

impl Participant {
    pub const MAX_NAME_LEN: usize = 32;

    pub const LEN: usize = 8 + // descriminator
        32 + // authority
        1 + // user_type
        8 + // registration_timestamp
        8 + // update_timestamp
        8 + // last_session_id
        32 + // name_registry
        1; // bump

    pub fn pda(pubkey: Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"participant", pubkey.as_ref()], &crate::ID)
    }

    pub fn set_name(&mut self, name: &str) -> Result<()> {
        let name_bytes = name.as_bytes();
        require!(
            name_bytes.len() <= Self::MAX_NAME_LEN,
            ParticipantError::NameTooLong
        );

        self.user_name_len = name_bytes.len() as u8;
        self.user_name[..name_bytes.len()].copy_from_slice(name_bytes);

        // Null remaining bytes
        if name_bytes.len() < Self::MAX_NAME_LEN {
            self.user_name[name_bytes.len()..].fill(0);
        }
        Ok(())
    }

    pub fn get_name(&self) -> &str {
        std::str::from_utf8(&self.user_name[..self.user_name_len as usize])
            .unwrap_or("invalid_utf8")
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum UserType {
    Participant,
    Admin,
    Officer,
}

#[error_code]
pub enum ParticipantError {
    #[msg("Name too long (max 32 characters)")]
    NameTooLong,

    #[msg("No permission to access")]
    Forbidden,

    #[msg("Wrong authority")]
    WrongAuthority,

    #[msg("Cannot change own user type")]
    CannotChangeSelf,
}
