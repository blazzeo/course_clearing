use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    custom_accounts::{ClearingSession, NetPosition, Obligation},
    errors::CustomErrors,
};

#[derive(Accounts)]
#[instruction(session_id: u64, to: Pubkey, timestamp: i64)]
pub struct SettlePosition<'info> {
    #[account(
        mut,
        seeds = [b"session", session_id.to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        mut,
        seeds = [b"position", session.key().as_ref(), authority.key().as_ref()],
        bump,
        constraint = net_position.fee_paid == true @ SettlePositionError::FeeNotPaid,
        constraint = net_position.net_amount > 0 @ SettlePositionError::NoNeedInPayment
    )]
    pub net_position: Account<'info, NetPosition>,

    #[account(
        mut,
        seeds = [b"obligation", authority.key().as_ref(), to.as_ref(), timestamp.to_le_bytes().as_ref()],
        bump
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn settle_position(ctx: Context<SettlePosition>) -> Result<()> {
    let net_position = &mut ctx.accounts.net_position;
    let obligation = &mut ctx.accounts.obligation;

    require!(
        net_position.net_amount != 0,
        SettlePositionError::ZeroPosition
    );

    //  Create instruction
    let transfer_instruction = Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: ctx.accounts.recipient.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        transfer_instruction,
    );

    //  Payment of net position
    system_program::transfer(cpi_ctx, net_position.fee_amount)?;

    //  Update net position amount
    net_position.net_amount = net_position
        .net_amount
        .checked_sub(obligation.amount as i64)
        .ok_or(CustomErrors::MathOverflow)?;

    obligation.status = crate::custom_accounts::ObligationStatus::Netted;

    Ok(())
}

#[error_code]
pub enum SettlePositionError {
    FeeNotPaid,
    NoNeedInPayment,
    ZeroPosition,
}
