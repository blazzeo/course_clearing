use anchor_lang::prelude::*;

use crate::{custom_accounts::{ClearingSession, ClearingSessionStatus, ClearingState, NetPosition, Obligation, ObligationPool, ObligationStatus}, errors::CustomErrors};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct ProcessObligation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        mut, 
        seeds = [b"session", (state.total_sessions).to_le_bytes().as_ref()], 
        bump = session.bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), timestamp.to_le_bytes().as_ref()],
        bump
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(
        mut,
        seeds = [b"pool", obligation.pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, ObligationPool>,

    #[account(
        init_if_needed,
        payer = payer,
        space = NetPosition::LEN,
        seeds = [b"position", session.key().as_ref(), obligation.from.as_ref()], 
        bump
    )]
    pub from_position: Account<'info, NetPosition>,

    #[account(
        init_if_needed,
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

pub fn process_obligation(ctx: Context<ProcessObligation>) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let state = &ctx.accounts.state;
    let session_id = session.id;

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

    // Remove obligation from pool
    let pool = &mut ctx.accounts.pool;
    pool.remove_obligation(obligation.key())?;

    // Update from position
    let from_pos = &mut ctx.accounts.from_position;
    from_pos.net_amount = from_pos
        .net_amount
        .checked_sub(obligation.amount as i64)
        .ok_or(CustomErrors::MathOverflow)?;

    //  Calculate new add fee and update total fee
    let add_fee_amount = state.calculate_fee(obligation.amount);
    from_pos.fee_amount = from_pos.fee_amount.checked_add(add_fee_amount).ok_or(CustomErrors::MathOverflow)?;

    // Update to position
    let to_pos = &mut ctx.accounts.to_position;
    to_pos.net_amount = to_pos
        .net_amount
        .checked_add(obligation.amount as i64)
        .ok_or(CustomErrors::MathOverflow)?;

    session.processed_count = session
        .processed_count
        .checked_add(1)
        .ok_or(CustomErrors::MathOverflow)?;

    Ok(())
}

#[error_code]
pub enum ClearingError {
    AlreadyProcessed,
    InvalidSessionStatus,
    InvalidObligationStatus
}
