use crate::custom_accounts::{Participant, ParticipantError, UserType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(participant: Pubkey, user_type: UserType)]
pub struct UpdateUserType<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ ParticipantError::Forbidden,
        constraint = admin.authority == authority.key() @ ParticipantError::WrongAuthority
    )]
    pub admin: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"participant", participant.as_ref()],
        bump
    )]
    pub target_participant: Account<'info, Participant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn update_user_type(ctx: Context<UpdateUserType>, user_type: UserType) -> Result<()> {
    let target = &mut ctx.accounts.target_participant;
    let admin = &ctx.accounts.admin;
    let clock = Clock::get()?;

    require!(
        target.key() != admin.key(),
        ParticipantError::CannotChangeSelf
    );

    target.user_type = user_type;
    target.update_timestamp = clock.unix_timestamp;

    msg!("User type updated for {} to {:?}", target.key(), user_type);

    Ok(())
}
