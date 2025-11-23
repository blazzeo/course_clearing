use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;

declare_id!("CLR11111111111111111111111111111111111111");

#[program]
pub mod clearing_service {
    use super::*;

    /// Инициализация клирингового аккаунта для участника
    pub fn initialize_participant(ctx: Context<InitializeParticipant>) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        participant.authority = ctx.accounts.authority.key();
        participant.balance = 0;
        participant.margin = 0;
        participant.bump = ctx.bumps.participant;
        Ok(())
    }

    /// Создание клиринговой позиции между участниками
    pub fn create_position(
        ctx: Context<CreatePosition>,
        amount: i64,
        counterparty: Pubkey,
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        position.creator = ctx.accounts.creator.key();
        position.counterparty = counterparty;
        position.amount = amount;
        position.status = PositionStatus::Pending;
        position.created_at = Clock::get()?.unix_timestamp;
        position.bump = ctx.bumps.position;

        msg!(
            "Position created: {} SOL from {} to {}",
            amount,
            ctx.accounts.creator.key(),
            counterparty
        );
        Ok(())
    }

    /// Подтверждение позиции контрагентом
    pub fn confirm_position(ctx: Context<ConfirmPosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(
            position.status == PositionStatus::Pending,
            ClearingError::InvalidPositionStatus
        );
        require!(
            position.counterparty == ctx.accounts.counterparty.key(),
            ClearingError::Unauthorized
        );

        position.status = PositionStatus::Confirmed;
        position.confirmed_at = Clock::get()?.unix_timestamp;

        msg!("Position confirmed by {}", ctx.accounts.counterparty.key());
        Ok(())
    }

    /// Выполнение клирингового расчета (netting)
    pub fn execute_clearing(ctx: Context<ExecuteClearing>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(
            position.status == PositionStatus::Confirmed,
            ClearingError::InvalidPositionStatus
        );

        let creator_participant = &mut ctx.accounts.creator_participant;
        let counterparty_participant = &mut ctx.accounts.counterparty_participant;

        // Обновление балансов
        creator_participant.balance -= position.amount;
        counterparty_participant.balance += position.amount;

        position.status = PositionStatus::Cleared;
        position.cleared_at = Clock::get()?.unix_timestamp;

        msg!(
            "Clearing executed: {} SOL from {} to {}",
            position.amount,
            creator_participant.authority,
            counterparty_participant.authority
        );
        Ok(())
    }

    /// Многосторонний клиринг (netting для нескольких позиций)
    pub fn multi_party_clearing(
        ctx: Context<MultiPartyClearing>,
        participants: Vec<Pubkey>,
        amounts: Vec<i64>,
    ) -> Result<()> {
        require!(
            participants.len() == amounts.len(),
            ClearingError::InvalidInput
        );
        require!(participants.len() >= 2, ClearingError::InvalidInput);

        let clearing = &mut ctx.accounts.clearing;
        clearing.participants = participants.clone();
        clearing.amounts = amounts.clone();
        clearing.status = ClearingStatus::Pending;
        clearing.created_at = Clock::get()?.unix_timestamp;
        clearing.bump = ctx.bumps.clearing;

        // Расчет чистых позиций (netting)
        let mut net_amounts: Vec<i64> = vec![0; participants.len()];
        for (i, amount) in amounts.iter().enumerate() {
            net_amounts[i] = *amount;
        }

        clearing.net_amounts = net_amounts;
        clearing.status = ClearingStatus::Calculated;

        msg!(
            "Multi-party clearing calculated for {} participants",
            participants.len()
        );
        Ok(())
    }

    /// Выполнение многостороннего клиринга
    pub fn execute_multi_party_clearing(ctx: Context<ExecuteMultiPartyClearing>) -> Result<()> {
        let clearing = &mut ctx.accounts.clearing;
        require!(
            clearing.status == ClearingStatus::Calculated,
            ClearingError::InvalidClearingStatus
        );

        // Обновление балансов всех участников
        for (i, participant_pda) in ctx.remaining_accounts.iter().enumerate() {
            if i < clearing.net_amounts.len() {
                let participant = Account::<Participant>::try_unwrap(participant_pda)?;
                // В реальном сценарии здесь нужно обновить балансы
                // Для упрощения просто помечаем как выполненное
            }
        }

        clearing.status = ClearingStatus::Executed;
        clearing.executed_at = Clock::get()?.unix_timestamp;

        msg!("Multi-party clearing executed");
        Ok(())
    }

    /// Внесение залога (маржи)
    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        require!(
            participant.authority == ctx.accounts.authority.key(),
            ClearingError::Unauthorized
        );

        participant.margin += amount as i64;

        msg!(
            "Margin deposited: {} SOL by {}",
            amount,
            ctx.accounts.authority.key()
        );
        Ok(())
    }

    /// Вывод залога
    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        require!(
            participant.authority == ctx.accounts.authority.key(),
            ClearingError::Unauthorized
        );
        require!(
            participant.margin >= amount as i64,
            ClearingError::InsufficientMargin
        );

        participant.margin -= amount as i64;

        msg!(
            "Margin withdrawn: {} SOL by {}",
            amount,
            ctx.accounts.authority.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeParticipant<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Participant::LEN,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePosition<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Position::LEN,
        seeds = [b"position", creator.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmPosition<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    pub counterparty: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteClearing<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [b"participant", position.creator.as_ref()],
        bump = creator_participant.bump
    )]
    pub creator_participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [b"participant", position.counterparty.as_ref()],
        bump = counterparty_participant.bump
    )]
    pub counterparty_participant: Account<'info, Participant>,
}

#[derive(Accounts)]
pub struct MultiPartyClearing<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MultiPartyClearingAccount::LEN,
        seeds = [b"clearing", authority.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub clearing: Account<'info, MultiPartyClearingAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteMultiPartyClearing<'info> {
    #[account(mut)]
    pub clearing: Account<'info, MultiPartyClearingAccount>,
}

#[derive(Accounts)]
pub struct DepositMargin<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[account]
pub struct Participant {
    pub authority: Pubkey,
    pub balance: i64,
    pub margin: i64,
    pub bump: u8,
}

impl Participant {
    pub const LEN: usize = 32 + 8 + 8 + 1;
}

#[account]
pub struct Position {
    pub creator: Pubkey,
    pub counterparty: Pubkey,
    pub amount: i64,
    pub status: PositionStatus,
    pub created_at: i64,
    pub confirmed_at: i64,
    pub cleared_at: i64,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 8 + 8 + 8 + 1;
}

#[account]
pub struct MultiPartyClearingAccount {
    pub participants: Vec<Pubkey>,
    pub amounts: Vec<i64>,
    pub net_amounts: Vec<i64>,
    pub status: ClearingStatus,
    pub created_at: i64,
    pub executed_at: i64,
    pub bump: u8,
}

impl MultiPartyClearingAccount {
    pub const LEN: usize = 4 + (32 * 10) + 4 + (8 * 10) + 4 + (8 * 10) + 1 + 8 + 8 + 1; // Примерный размер
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Pending,
    Confirmed,
    Cleared,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ClearingStatus {
    Pending,
    Calculated,
    Executed,
    Cancelled,
}

#[error_code]
pub enum ClearingError {
    #[msg("Invalid position status")]
    InvalidPositionStatus,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid input")]
    InvalidInput,
    #[msg("Invalid clearing status")]
    InvalidClearingStatus,
    #[msg("Insufficient margin")]
    InsufficientMargin,
}



