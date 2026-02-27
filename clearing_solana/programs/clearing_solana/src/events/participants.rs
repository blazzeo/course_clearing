use anchor_lang::prelude::*;

#[event]
pub struct ParticipantRegistered {
    pub pariticipant: Pubkey,
    pub timestamp: i64,
}
