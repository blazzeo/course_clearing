use anchor_lang::prelude::*;

use crate::custom_accounts::{ClearingSession, ClearingSessionStatus, ClearingState};

#[derive(Accounts)]
pub struct FinalizeClearingSession<'info> {
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
        seeds = [b"session", (state.total_sessions).to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_clearing_session(ctx: Context<FinalizeClearingSession>) -> Result<()> {
    let clock = Clock::get()?;

    let session = &mut ctx.accounts.session;

    session.status = ClearingSessionStatus::Closed;
    session.closed_at = clock.unix_timestamp;

    Ok(())
}
