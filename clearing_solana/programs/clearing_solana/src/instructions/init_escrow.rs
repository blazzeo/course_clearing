use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{Escrow, Participant, UserType},
    errors::CustomErrors,
    events::admin::EscrowInitialized,
};

#[derive(Accounts)]
pub struct InitEscrow<'info> {
    #[account(
        init,
        payer = authority,
        space = Escrow::LEN,
        seeds = [b"escrow"],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ CustomErrors::Forbidden,
        constraint = authority.key() == admin.authority @ CustomErrors::Unauthorized
    )]
    pub admin: Account<'info, Participant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Method to init escrow account
/// Must be invoked by admin
pub fn init_escrow(ctx: Context<InitEscrow>) -> Result<()> {
    let clock = Clock::get()?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.authority = ctx.accounts.authority.key();
    escrow.total_fees = 0;
    escrow.bump = ctx.bumps.escrow;

    emit!(EscrowInitialized {
        admin: ctx.accounts.authority.key(),
        escrow: escrow.key(),
        timestamp: clock.unix_timestamp
    });

    Ok(())
}
