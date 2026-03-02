use anchor_lang::prelude::*;

use crate::custom_accounts::{ClearingSession, ClearingSessionStatus, NetPosition, Obligation, ObligationStatus};

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct ProcessObligation<'info> {
    #[account(
        mut, 
        seeds = [b"session", session_id.to_le_bytes().as_ref()], 
        bump = session.bump)
    ]
    pub session: Account<'info, ClearingSession>,

    #[account(mut)]
    pub obligation: Account<'info, Obligation>,

    #[account(
        init,
        payer = payer,
        space = NetPosition::LEN,
        seeds = [b"position", session.key().as_ref(), obligation.from.as_ref()], 
        bump
    )]
    pub from_position: Account<'info, NetPosition>,

    #[account(
        init,
        payer = payer,
        space = NetPosition::LEN,
        seeds = [b"position", session.key().as_ref(), obligation.to.as_ref()], 
        bump
    )]
    pub to_position: Account<'info, NetPosition>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn process_obligation(ctx: Context<ProcessObligation>, session_id: u64) -> Result<()> {
    let session = &mut ctx.accounts.session;
    require!(
        session.status == ClearingSessionStatus::Open,
        ClearingError::InvalidSessionStatus
    );

    let obligation = &mut ctx.accounts.obligation;
    require!(
        obligation.status == ObligationStatus::Created
            || obligation.status == ObligationStatus::Confirmed,
        ClearingError::InvalidObligationStatus
    );
    require!(
        obligation.session_id.is_none(),
        ClearingError::AlreadyProcessed
    );

    // Mark obligation as compeleted in that session
    obligation.session_id = Some(session_id);
    obligation.status = ObligationStatus::Netted;

    // Update from position
    let from_pos = &mut ctx.accounts.from_position;
    from_pos.net_amount = from_pos
        .net_amount
        .checked_sub(obligation.amount as i64)
        .ok_or(ClearingError::Overflow)?;

    // Update to position
    let to_pos = &mut ctx.accounts.to_position;
    to_pos.net_amount = to_pos
        .net_amount
        .checked_add(obligation.amount as i64)
        .ok_or(ClearingError::Overflow)?;

    session.processed_count = session
        .processed_count
        .checked_add(1)
        .ok_or(ClearingError::Overflow)?;

    Ok(())
}

#[error_code]
pub enum ClearingError {
    Overflow,
    AlreadyProcessed,
    InvalidSessionStatus,
    InvalidObligationStatus
}
