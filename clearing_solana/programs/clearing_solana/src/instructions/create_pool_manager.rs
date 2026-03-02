use anchor_lang::prelude::*;

use crate::custom_accounts::{ObligationPool, PoolManager};

#[derive(Accounts)]
pub struct CreatePoolManager<'info> {
    #[account(
        init,
        payer = authority,
        space = ObligationPool::LEN,
        seeds = [b"pool", &(0u32).to_le_bytes()],
        bump
    )]
    pub root_pool: Account<'info, ObligationPool>,

    #[account(
        init,
        payer = authority,
        space = PoolManager::LEN,
        seeds = [b"pool_manager"],
        bump
    )]
    pub pool_manager: Account<'info, PoolManager>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Method to create pool manager(dispatcher)
pub fn create_pool_manager(ctx: Context<CreatePoolManager>) -> Result<()> {
    let root_pool = &mut ctx.accounts.root_pool;
    root_pool.id = 0;
    root_pool.authority = ctx.accounts.authority.key();
    root_pool.obligations = [Pubkey::default(); 100];
    root_pool.occupied = [false; 100];
    root_pool.occupied_count = 0;
    root_pool.next_pool = None;
    root_pool.prev_pool = None;
    root_pool.bump = ctx.bumps.root_pool;

    let pool_manager = &mut ctx.accounts.pool_manager;
    pool_manager.authority = ctx.accounts.authority.key();
    pool_manager.root_pool = ctx.accounts.root_pool.key();
    pool_manager.bump = ctx.bumps.pool_manager;

    Ok(())
}

#[error_code]
pub enum CreatePoolManagerError {
    Forbidden,
    Unauthorized,
}
