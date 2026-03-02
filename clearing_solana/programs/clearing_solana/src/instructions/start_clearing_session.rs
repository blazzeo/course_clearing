use anchor_lang::prelude::*;

use crate::custom_accounts::{ClearingSession, ClearingSessionStatus, ObligationPool};

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct StartClearingSession<'info> {
    #[account(
        init,
        payer = authority,
        space = ClearingSession::LEN,
        seeds = [b"session", session_id.to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        seeds = [b"pool", &(0i32).to_le_bytes()],
        bump
    )]
    pub root_pool: Account<'info, ObligationPool>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn start_clearing_session(ctx: Context<StartClearingSession>, session_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let session = &mut ctx.accounts.session;

    session.id = session_id;
    session.status = ClearingSessionStatus::Open;
    session.opened_at = clock.unix_timestamp;
    session.closed_at = 0;
    session.processed_count = 0;
    session.participant_count = 0;
    session.total_obligations = 0;
    session.bump = ctx.bumps.session;

    Ok(())
}

// #[error_code]
// pub enum StartClearingSessionError {
//
// }
