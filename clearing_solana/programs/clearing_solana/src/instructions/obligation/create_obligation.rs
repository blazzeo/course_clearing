use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{ClearingState, Obligation, ObligationError, ObligationPool, Participant},
    errors::CustomErrors,
};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, amount: u64, pool_id: u32)]
pub struct RegisterObligation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        init,
        payer = authority,
        space = Obligation::LEN,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub new_obligation: Account<'info, Obligation>,

    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"pool", &(pool_id).to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, ObligationPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method to create new obligation(from-to-amount)
pub fn register_obligation(
    ctx: Context<RegisterObligation>,
    from: Pubkey,
    to: Pubkey,
    amount: u64,
    pool_id: u32,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(from != to, ObligationError::FromToEquals);

    let obligation = &mut ctx.accounts.new_obligation;
    obligation.status = crate::custom_accounts::ObligationStatus::Created;
    obligation.from = from;
    obligation.to = to;
    obligation.amount = amount;
    obligation.timestamp = clock.unix_timestamp;
    obligation.session_id = None;
    obligation.bump = ctx.bumps.new_obligation;
    obligation.pool_id = pool_id;

    //  Try to push obligation to pool
    //  if failure - retry with next pool_id
    let pool = &mut ctx.accounts.pool;
    pool.add_obligation(obligation.key())?;

    //  Update system's state
    let state = &mut ctx.accounts.state;
    state.total_obligations = state
        .total_obligations
        .checked_add(1)
        .ok_or(CustomErrors::MathOverflow)?;

    let participant = &mut ctx.accounts.participant;
    participant.update_timestamp = clock.unix_timestamp;

    Ok(())
}
