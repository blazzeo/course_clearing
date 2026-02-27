use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{
    custom_accounts::{Escrow, Participant, SessionFee},
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
        constraint = participant.authority == authority.key() @ PayFeeError::Unauthorized
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"session_fee", authority.key().as_ref() ,&session_id.to_le_bytes()],
        bump,
        constraint = session_fee.participant == participant.key() @ PayFeeError::InvalidFeeAccount,
        constraint = !session_fee.paid @ PayFeeError::AlreadyPaid,
        constraint = session_fee.session_id == session_id @ PayFeeError::SessionIdMismatch
    )]
    pub session_fee: Account<'info, SessionFee>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn pay_fee(ctx: Context<PayFee>, session_id: u64) -> Result<()> {
    let clock = Clock::get()?;

    let escrow = &mut ctx.accounts.escrow;
    let participant = &mut ctx.accounts.participant;
    let session_fee = &mut ctx.accounts.session_fee;

    require!(session_fee.fee_amount > 0, PayFeeError::InvalidFeeAccount);

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
    system_program::transfer(cpi_ctx, session_fee.fee_amount)?;

    //  Update state
    session_fee.paid = true;
    escrow.total_fees = escrow
        .total_fees
        .checked_add(session_fee.fee_amount)
        .ok_or(PayFeeError::MathOverflow)?;

    participant.update_timestamp = clock.unix_timestamp;

    emit!(FeePaid {
        participant: ctx.accounts.authority.key(),
        session_id: session_id,
        amount: session_fee.fee_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum PayFeeError {
    Unauthorized,
    InvalidFeeAccount,
    Forbidden,
    SessionIdMismatch,
    InvalidFeeAmount,
    AlreadyPaid,
    MathOverflow,
}
