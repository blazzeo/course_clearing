use anchor_lang::prelude::*;

use crate::{custom_accounts::ObligationPool, events::pools::PoolCreated};

#[derive(Accounts)]
#[instruction(last_pool_id: u32)]
pub struct CreateNewPool<'info> {
    #[account(
        seeds = [b"pool", &(last_pool_id).to_le_bytes()],
        bump,
        constraint = last_pool.next_pool == None @  CreateNewPoolError::PoolNotLast
    )]
    pub last_pool: Account<'info, ObligationPool>,

    #[account(
        init,
        payer = authority,
        space = ObligationPool::LEN,
        seeds = [b"pool", &(last_pool.id+1).to_le_bytes()],
        bump
    )]
    pub new_pool: Account<'info, ObligationPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_new_pool(ctx: Context<CreateNewPool>, last_pool_id: u32) -> Result<()> {
    let clock = Clock::get()?;

    let last_pool = &mut ctx.accounts.last_pool;

    //  Configure new pool
    let new_pool = &mut ctx.accounts.new_pool;
    new_pool.authority = last_pool.authority;
    new_pool.id = last_pool_id + 1;
    new_pool.obligations = [Pubkey::default(); 100];
    new_pool.occupied = [false; 100];
    new_pool.occupied_count = 0;
    new_pool.next_pool = None;
    new_pool.prev_pool = Some(last_pool.key());
    new_pool.bump = ctx.bumps.new_pool;

    //  Link new pool with last
    last_pool.next_pool = Some(new_pool.key());

    emit!(PoolCreated {
        id: last_pool_id + 1,
        timestamp: clock.unix_timestamp
    });

    Ok(())
}

#[error_code]
pub enum CreateNewPoolError {
    PoolNotLast,
}
