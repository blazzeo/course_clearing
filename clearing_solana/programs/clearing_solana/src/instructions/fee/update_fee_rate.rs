use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{ClearingState, Participant, UserType},
    events::fees::FeeRateUpdated,
};

#[derive(Accounts)]
pub struct UpdateFeeRate<'info> {
    #[account(
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ UpdateFeeRateError::Forbidden,
        constraint = admin.authority == authority.key() @ UpdateFeeRateError::Unauthorized
    )]
    pub admin: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method to update fee rate,
/// must be invoked by admin
pub fn update_fee_rate(ctx: Context<UpdateFeeRate>, new_rate_bps: u64) -> Result<()> {
    let clock = Clock::get()?;

    require!(new_rate_bps <= 10000, UpdateFeeRateError::InvalidRate);

    let state = &mut ctx.accounts.state;
    let admin = &mut ctx.accounts.admin;
    let old_rate_bps = state.fee_rate_bps;

    state.fee_rate_bps = new_rate_bps;
    state.update_timestamp = clock.unix_timestamp;
    admin.update_timestamp = clock.unix_timestamp;

    emit!(FeeRateUpdated {
        admin: admin.authority,
        old_rate: old_rate_bps,
        new_rate: new_rate_bps,
        timestamp: clock.unix_timestamp
    });

    Ok(())
}

#[error_code]
pub enum UpdateFeeRateError {
    NegativeRate,
    InvalidRate,
    Unauthorized,
    Forbidden,
}
