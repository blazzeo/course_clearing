use anchor_lang::prelude::*;

/// Account for bills of fees to participants
#[account]
pub struct SessionFee {
    pub session_id: u64,
    pub participant: Pubkey,
    pub paid: bool,
    pub fee_amount: u64,
    pub bump: u8,
}

impl SessionFee {
    pub const LEN: usize = 8 + // descriminator
        8 + // session_id
        32 + // participant
        1 + // paid
        8 + // fee_amount
        1; // bump

    pub fn pda(participant: Pubkey, session_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"session_fee",
                participant.as_ref(),
                &session_id.to_le_bytes(),
            ],
            &crate::ID,
        )
    }
}
