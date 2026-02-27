use crate::custom_accounts::{NameRegistry, Participant, ParticipantError, UserType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterParticipant<'info> {
    #[account(
        init,
        payer = authority,
        space = Participant::LEN,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub new_participant: Account<'info, Participant>,

    #[account(
        init,
        payer = authority,
        space = NameRegistry::LEN,
        seeds = [b"name_registry", name.as_bytes()],
        bump
    )]
    pub name_registry: Account<'info, NameRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_participant(ctx: Context<RegisterParticipant>, name: String) -> Result<()> {
    let clock = Clock::get()?;

    //  Check Name length
    require!(
        name.len() <= Participant::MAX_NAME_LEN,
        ParticipantError::NameTooLong
    );

    //  Save name in Registry
    let registry = &mut ctx.accounts.name_registry;
    let mut name_bytes: [u8; 32] = [0; 32];
    let len = name.as_bytes().len().min(32);
    name_bytes[..len].copy_from_slice(&name.as_bytes()[..len]);

    registry.name_bytes = name_bytes;
    registry.participant = ctx.accounts.authority.key();
    registry.bump = ctx.bumps.name_registry;

    //  Save participant himself
    let participant = &mut ctx.accounts.new_participant;
    participant.authority = ctx.accounts.authority.key();
    participant.user_type = UserType::Participant;
    participant.set_name(&name)?;
    participant.user_name_len = name.len() as u8;
    participant.registration_timestamp = clock.unix_timestamp;
    participant.update_timestamp = clock.unix_timestamp;
    participant.last_session_id = 0;
    participant.name_registry = ctx.accounts.name_registry.key();
    participant.bump = ctx.bumps.new_participant;

    Ok(())
}
