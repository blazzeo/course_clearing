use anchor_lang::prelude::*;

use crate::{
    custom_accounts::{Obligation, ObligationStatus, Participant},
    events::obligations::ObligationCancelled,
};

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct CancelObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = from_participant.authority == from @ CancelObligationError::InvalidFromParticipant
    )]
    pub from_participant: Account<'info, Participant>,

    #[account(
        seeds = [b"participant", to.as_ref()],
        bump,
        constraint = to_participant.authority == to @ CancelObligationError::InvalidToParticipant
    )]
    pub to_participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump,
        constraint = obligation.from == from @ CancelObligationError::Forbidden,
        constraint = obligation.to == to @ CancelObligationError::Forbidden,
    )]
    pub obligation: Account<'info, Obligation>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method must be called by both participants of obligation.
/// Each will interact only with his 'cancel flag'.
/// When both flags are true - only then obligation is considered as 'Canceled'.
pub fn cancel_obligation(ctx: Context<CancelObligation>) -> Result<()> {
    // Get time for timestamp
    let clock = Clock::get()?;

    let obligation = &mut ctx.accounts.obligation;

    // Check for proper obligation status
    require!(
        obligation.status == ObligationStatus::Created
            || obligation.status == ObligationStatus::Confirmed,
        CancelObligationError::InvalidStatus
    );

    let authority = ctx.accounts.authority.key();

    //  Cancel by 'to_participant'
    if authority == ctx.accounts.to_participant.authority {
        require!(
            obligation.to_cancel != true,
            CancelObligationError::Duplication
        );
        obligation.to_cancel = true;

        let to_participant = &mut ctx.accounts.to_participant;
        to_participant.update_timestamp = clock.unix_timestamp;
    }

    //  Cancel by 'from_participant'
    if authority == ctx.accounts.from_participant.authority {
        require!(
            obligation.from_cancel != true,
            CancelObligationError::Duplication
        );
        obligation.from_cancel = true;

        let from_participant = &mut ctx.accounts.from_participant;
        from_participant.update_timestamp = clock.unix_timestamp;
    }

    //  Check for both confirmations
    if obligation.to_cancel && obligation.from_cancel {
        obligation.status = ObligationStatus::Cancelled;

        // Event
        emit!(ObligationCancelled {
            obligation: obligation.key(),
            from: ctx.accounts.from_participant.key(),
            to: ctx.accounts.to_participant.key(),
            amount: obligation.amount,
            timestamp: clock.unix_timestamp
        });

        msg!("Obligation {} cancelled by both parties", obligation.key());
    }

    Ok(())
}

#[error_code]
pub enum CancelObligationError {
    Unauthorized,
    InvalidStatus,
    Duplication,
    Forbidden,
    InvalidToParticipant,
    InvalidFromParticipant,
}
