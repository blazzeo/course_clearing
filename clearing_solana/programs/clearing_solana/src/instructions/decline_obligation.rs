use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{Obligation, ObligationStatus, Participant},
    events::obligations::ObligationDeclined,
};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct DeclineObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = authority.key() == from @ DeclineObligationError::Unauthorized,
        constraint = from_participant.authority == from @ DeclineObligationError::InvalidFromParticipant
    )]
    pub from_participant: Account<'info, Participant>,

    #[account(
        seeds = [b"participant", to.as_ref()],
        bump,
        constraint = to_participant.authority == to @ DeclineObligationError::InvalidToParticipant
    )]
    pub to_participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump,
        constraint = obligation.from == from @ DeclineObligationError::Forbidden,
        constraint = obligation.to == to @ DeclineObligationError::Forbidden,
    )]
    pub obligation: Account<'info, Obligation>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method to decline obligation if 'from participant' disagree with conditions
pub fn decline_obligation(ctx: Context<DeclineObligation>) -> Result<()> {
    let clock = Clock::get()?;

    let obligation = &mut ctx.accounts.obligation;

    require!(
        obligation.status == ObligationStatus::Created,
        DeclineObligationError::InvalidStatus
    );

    obligation.status = ObligationStatus::Declined;

    let from_participant = &mut ctx.accounts.from_participant;
    from_participant.update_timestamp = clock.unix_timestamp;

    // Event
    emit!(ObligationDeclined {
        obligation: obligation.key(),
        from: ctx.accounts.from_participant.key(),
        to: ctx.accounts.to_participant.key(),
        amount: obligation.amount,
        timestamp: clock.unix_timestamp
    });

    Ok(())
}

#[error_code]
pub enum DeclineObligationError {
    Unauthorized,
    InvalidStatus,
    Forbidden,
    InvalidToParticipant,
    InvalidFromParticipant,
}
