use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{ClearingSession, ClearingSessionStatus, ClearingState},
    errors::CustomErrors,
};

#[derive(Accounts)]
pub struct StartClearingSession<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        init,
        payer = authority,
        space = ClearingSession::LEN,
        seeds = [b"session", (state.total_sessions + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn start_clearing_session(
    ctx: Context<StartClearingSession>,
    total_obligations: u32,
) -> Result<()> {
    let clock = Clock::get()?;

    // Increment session_id
    let state = &mut ctx.accounts.state;
    state.total_sessions = state
        .total_sessions
        .checked_add(1)
        .ok_or(CustomErrors::MathOverflow)?;

    let session = &mut ctx.accounts.session;

    session.id = state.total_sessions;
    session.status = ClearingSessionStatus::Open;
    session.opened_at = clock.unix_timestamp;
    session.closed_at = 0;
    session.processed_count = 0;
    session.total_obligations = total_obligations;
    session.bump = ctx.bumps.session;

    Ok(())
}
