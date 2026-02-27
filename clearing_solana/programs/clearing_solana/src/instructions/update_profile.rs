use anchor_lang::prelude::*;

use crate::custom_accounts::{ClearingEngine, ClearingEngineError, ClearingState, Participant};

#[derive(Accounts)]
#[instruction(participant: Pubkey)]
pub struct UpdateParticipantLastSessionId<'info> {
    #[account(
        mut,
        seeds = [b"participant", participant.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        seeds = [b"engine"],
        bump,
        constraint = clearing_engine.authority == authority.key() @ ClearingEngineError::Unauthorized
    )]
    pub clearing_engine: Account<'info, ClearingEngine>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_participant_last_session_id(
    ctx: Context<UpdateParticipantLastSessionId>,
    session_id: u64,
) -> Result<()> {
    let clearing_state = &ctx.accounts.state;

    require!(
        clearing_state.total_sessions == session_id,
        SessionIdError::InvalidId
    );

    let participant = &mut ctx.accounts.participant;

    require!(
        participant.last_session_id < session_id,
        SessionIdError::SessionIdNotGreater
    );

    participant.last_session_id = session_id;

    Ok(())
}

#[error_code]
pub enum SessionIdError {
    #[msg("Invalid Session Id provided")]
    InvalidId,

    #[msg("Session Id must be greater than previous")]
    SessionIdNotGreater,
}
