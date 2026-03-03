use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    custom_accounts::{ClearingSession, Escrow, NetPosition, Participant},
    errors::CustomErrors,
    events::fees::FeePaid,
};

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct PayFee<'info> {
    #[account(
        mut,
        seeds = [b"escrow"],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = participant.authority == authority.key() @ CustomErrors::Unauthorized
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        mut, 
        seeds = [b"session", (session_id).to_le_bytes().as_ref()], 
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        mut,
        seeds = [b"position", session.key().as_ref(), participant.key().as_ref()],
        bump,
        constraint = !net_position.fee_paid @ PayFeeError::AlreadyPaid,
    )]
    pub net_position: Account<'info, NetPosition>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method to pay fee of the session
pub fn pay_fee(ctx: Context<PayFee>, session_id: u64) -> Result<()> {
    let clock = Clock::get()?;

    let escrow = &mut ctx.accounts.escrow;
    let participant = &mut ctx.accounts.participant;
    let net_position = &mut ctx.accounts.net_position;

    require!(net_position.fee_amount > 0, PayFeeError::InvalidFeeAccount);

    //  Create instruction
    let transfer_instruction = Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: escrow.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        transfer_instruction,
    );

    //  Payment of fee
    system_program::transfer(cpi_ctx, net_position.fee_amount)?;

    //  Update state
    net_position.fee_paid = true;
    escrow.total_fees = escrow
        .total_fees
        .checked_add(net_position.fee_amount)
        .ok_or(CustomErrors::MathOverflow)?;

    participant.update_timestamp = clock.unix_timestamp;

    emit!(FeePaid {
        participant: ctx.accounts.authority.key(),
        session_id: session_id,
        amount: net_position.fee_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum PayFeeError {
    InvalidFeeAccount,
    SessionIdMismatch,
    InvalidFeeAmount,
    AlreadyPaid,
}
