use anchor_lang::prelude::{clock::UnixTimestamp, *};

#[account]
pub struct Obligation {
    pub status: ObligationStatus,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub session_id: u64, // default 0 (no session_id is linked at first)
    pub from_cancel: bool,
    pub to_cancel: bool,
    pub pool_id: u8,
    pub bump: u8,
}

impl Obligation {
    pub const LEN: usize = 8 + // descriminator
        1 + // status
        32 + // from
        32 + // to
        8 + // amount
        8 + // timestamp
        8 + // session_id
        1 + // from_cancel
        1 + // to_cancel
        1 + // pool_id
        1; // bump

    // TODO: OR linked-list to connect from-to-session_id obligations OR from-to-timestamp
    pub fn pda(from: Pubkey, to: Pubkey, timestamp: UnixTimestamp) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"obligation",
                from.as_ref(),
                to.as_ref(),
                &timestamp.to_le_bytes(),
            ],
            &crate::ID,
        )
    }

    pub fn set_session(&mut self, session_id: u64) {
        self.session_id = session_id;
    }

    pub fn update_status(&mut self, status: ObligationStatus) {
        self.status = status;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ObligationStatus {
    Created,
    Confirmed,
    Declined,
    Netted,
    Cancelled,
}

#[error_code]
pub enum ObligationError {
    #[msg("From and To cannot be the same")]
    FromToEquals,

    #[msg("Unauthorized")]
    Unauthorized,
}
