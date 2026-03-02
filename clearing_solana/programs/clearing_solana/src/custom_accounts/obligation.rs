use anchor_lang::prelude::{clock::UnixTimestamp, *};

/// Obligation from participant A to participant B
/// After creation it will be sticked to Pool X
/// session_id is 0 by default, but will be assigned to X on clearing session
/// from and to cancel flags are for cancelation before clearing session,
/// after cancelation obligation will be removed from Pool
#[account]
pub struct Obligation {
    pub status: ObligationStatus,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub session_id: Option<u64>, // default None (no session_id is linked at first)
    pub from_cancel: bool,
    pub to_cancel: bool,
    pub pool_id: u32,
    pub bump: u8,
}

impl Obligation {
    pub const LEN: usize = std::mem::size_of::<Self>();

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
        self.session_id = Some(session_id);
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
