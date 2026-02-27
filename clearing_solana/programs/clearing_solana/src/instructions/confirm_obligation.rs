use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{Obligation, ObligationStatus, Participant},
    events::obligations::ObligationConfirmed,
};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct ConfirmObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = authority.key() == from @ ConfirmObligationError::Unauthorized,
        constraint = from_participant.authority == from @ ConfirmObligationError::InvalidFromParticipant
    )]
    pub from_participant: Account<'info, Participant>,

    #[account(
        seeds = [b"participant", to.as_ref()],
        bump,
        constraint = to_participant.authority == to @ ConfirmObligationError::InvalidToParticipant
    )]
    pub to_participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump,
        constraint = obligation.from == from @ ConfirmObligationError::Forbidden,
        constraint = obligation.to == to @ ConfirmObligationError::Forbidden,
    )]
    pub obligation: Account<'info, Obligation>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn confirm_obligation(ctx: Context<ConfirmObligation>) -> Result<()> {
    let clock = Clock::get()?;

    let obligation = &mut ctx.accounts.obligation;

    require!(
        obligation.status == ObligationStatus::Created,
        ConfirmObligationError::InvalidStatus
    );

    obligation.status = ObligationStatus::Confirmed;

    let from_participant = &mut ctx.accounts.from_participant;
    from_participant.update_timestamp = clock.unix_timestamp;

    // Event
    emit!(ObligationConfirmed {
        obligation: obligation.key(),
        from: ctx.accounts.from_participant.key(),
        to: ctx.accounts.to_participant.key(),
        amount: obligation.amount,
        timestamp: clock.unix_timestamp
    });

    Ok(())
}

#[error_code]
pub enum ConfirmObligationError {
    Unauthorized,
    Forbidden,
    InvalidStatus,
    InvalidToParticipant,
    InvalidFromParticipant,
}
