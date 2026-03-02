use anchor_lang::prelude::*;

use crate::custom_accounts::{Obligation, ObligationError, ObligationPool, Participant};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, amount: u64)]
pub struct RegisterObligation<'info> {
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
        seeds = [b"pool", &(0i32).to_le_bytes()],
        bump
    )]
    pub root_pool: Account<'info, ObligationPool>,

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
) -> Result<()> {
    let clock = Clock::get()?;

    require!(from != to, ObligationError::FromToEquals);

    let obligation = &mut ctx.accounts.new_obligation;
    obligation.status = crate::custom_accounts::ObligationStatus::Created;
    obligation.from = from;
    obligation.to = to;
    obligation.amount = amount;
    obligation.timestamp = clock.unix_timestamp;
    obligation.session_id = 0;
    obligation.bump = ctx.bumps.new_obligation;

    let root_pool = &mut ctx.accounts.root_pool;
    let pool = root_pool;

    // Trying to push obligation till success
    loop {
        match pool.add_obligation(obligation.key()) {
            Ok(pool_id) => {
                obligation.pool_id = pool_id;
                break;
            }
            Err(err) => {
                // Get next pool from pool.next_pool
                // if needed to create that new account
                pool = pool.next_pool;
            }
        }
    }

    let participant = &mut ctx.accounts.participant;
    participant.update_timestamp = clock.unix_timestamp;

    Ok(())
}
