use std::fmt::Debug;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("ARJmooR8RhUjSkYiYBYtDSpPam1khAmYorn2ckmUC9vQ");

#[program]
pub mod clearing_service {
    use super::*;

    /// Инициализация аккаунта участника для работы со средствами
    pub fn initialize_participant(ctx: Context<InitializeParticipant>) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        participant.authority = ctx.accounts.authority.key();
        participant.balance = 0;
        participant.withdrawal_nonce = 0;
        participant.bump = ctx.bumps.participant;

        msg!("Participant initialized: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Депозит средств в систему (escrow)
    pub fn deposit_funds(ctx: Context<DepositFunds>, amount: u64) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        let escrow = &mut ctx.accounts.escrow;

        require!(
            participant.authority == ctx.accounts.authority.key(),
            ClearingError::Unauthorized
        );

        // Перевод средств на escrow аккаунт
        let transfer_ix =
            system_instruction::transfer(&ctx.accounts.authority.key(), &escrow.key(), amount);

        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                escrow.to_account_info(),
            ],
        )?;

        // Обновляем баланс в смарт-контракте
        participant.balance += amount as i64;
        escrow.total_locked += amount as i64;

        msg!(
            "Funds deposited: {} lamports by {}",
            amount,
            ctx.accounts.authority.key()
        );
        Ok(())
    }

    /// Запрос на вывод средств (создает pending withdrawal)
    pub fn request_withdrawal(ctx: Context<RequestWithdrawal>, amount: u64) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        let withdrawal = &mut ctx.accounts.withdrawal;
        let current_time = Clock::get()?.unix_timestamp;

        require!(
            participant.authority == ctx.accounts.authority.key(),
            ClearingError::Unauthorized
        );
        require!(
            participant.balance >= amount as i64,
            ClearingError::InsufficientFunds
        );

        // Сохраняем текущий nonce для использования в seeds
        let current_nonce = participant.withdrawal_nonce;

        // Увеличиваем nonce для следующего withdrawal
        participant.withdrawal_nonce = current_nonce.checked_add(1).unwrap();

        // Создаем запрос на вывод
        withdrawal.participant = participant.authority;
        withdrawal.amount = amount;
        withdrawal.status = WithdrawalStatus::Pending;
        withdrawal.requested_at = current_time;
        withdrawal.nonce = current_nonce; // Сохраняем использованный nonce
        withdrawal.bump = ctx.bumps.withdrawal;

        msg!(
            "Withdrawal requested: {} lamports by {}",
            amount,
            ctx.accounts.authority.key(),
        );
        Ok(())
    }

    /// Администратор утверждает вывод средств и переводит деньги
    pub fn approve_withdrawal(ctx: Context<ApproveWithdrawal>) -> Result<()> {
        let withdrawal = &mut ctx.accounts.withdrawal;
        let participant = &mut ctx.accounts.participant;
        let escrow = &mut ctx.accounts.escrow;

        msg!(
            "Withdrawal status before approval check: {:?}",
            withdrawal.status
        );

        require!(
            withdrawal.status == WithdrawalStatus::Pending,
            ClearingError::InvalidWithdrawalStatus
        );

        // Проверяем, что у участника достаточно средств
        require!(
            participant.balance >= withdrawal.amount as i64,
            ClearingError::InsufficientFunds
        );

        // Перевод средств с escrow на кошелек пользователя
        **escrow.to_account_info().try_borrow_mut_lamports()? -= withdrawal.amount;
        **ctx
            .accounts
            .recipient
            .to_account_info()
            .try_borrow_mut_lamports()? += withdrawal.amount;

        // Обновляем статусы
        withdrawal.status = WithdrawalStatus::Completed;
        withdrawal.approved_at = Clock::get()?.unix_timestamp;
        withdrawal.completed_at = withdrawal.approved_at;

        // Снимаем средства с баланса участника
        participant.balance -= withdrawal.amount as i64;
        escrow.total_locked -= withdrawal.amount as i64;

        msg!(
            "Withdrawal completed: {} lamports transferred to {}",
            withdrawal.amount,
            ctx.accounts.recipient.key()
        );
        Ok(())
    }

    /// Инициализация глобального escrow аккаунта
    pub fn initialize_escrow(ctx: Context<InitializeEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.authority = ctx.accounts.authority.key();
        escrow.total_locked = 0;
        escrow.bump = ctx.bumps.escrow;

        msg!("Escrow initialized by {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Utility to get last participant's withdrawal nonce
    pub fn get_withdrawal_nonce(ctx: Context<GetWithdrawalNonce>) -> Result<u64> {
        Ok(ctx.accounts.participant.withdrawal_nonce)
    }
}

#[derive(Accounts)]
pub struct GetWithdrawalNonce<'info> {
    #[account(
        seeds = [b"participant", authority.key().as_ref(), &[1]],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeParticipant<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Participant::LEN,
        seeds = [b"participant", authority.key().as_ref(), &[1]],
        bump
    )]
    pub participant: Account<'info, Participant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositFunds<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref(), &[1]],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [b"escrow"],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestWithdrawal<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref(), &[1]],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        init,
        payer = authority,
        space = 8 + Withdrawal::LEN,
        seeds = [b"withdrawal", authority.key().as_ref(), &participant.withdrawal_nonce.to_le_bytes()],
        bump
    )]
    pub withdrawal: Account<'info, Withdrawal>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveWithdrawal<'info> {
    #[account(mut)]
    pub withdrawal: Account<'info, Withdrawal>,
    #[account(
        mut,
        seeds = [b"participant", withdrawal.participant.as_ref(), &[1]],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [b"escrow"],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeWithdrawal<'info> {
    #[account(mut)]
    pub withdrawal: Account<'info, Withdrawal>,

    #[account(
        mut,
        seeds = [b"escrow"],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeClearingSettlement<'info> {
    #[account(
        mut,
        seeds = [b"participant", participant_from.authority.as_ref(), &[1]],
        bump = participant_from.bump
    )]
    pub participant_from: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [b"participant", participant_to.authority.as_ref(), &[1]],
        bump = participant_to.bump
    )]
    pub participant_to: Account<'info, Participant>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Escrow::LEN,
        seeds = [b"escrow"],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Participant {
    pub authority: Pubkey,
    pub balance: i64,
    pub bump: u8,
    pub withdrawal_nonce: u64,
}

impl Participant {
    pub const LEN: usize = 32 + 8 + 1 + 8; // authority + balance + bump + withdrawal_nonce
}

#[account]
pub struct Escrow {
    pub authority: Pubkey,
    pub total_locked: i64,
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 32 + 8 + 1; // authority + total_locked + bump
}

#[account]
pub struct Withdrawal {
    pub participant: Pubkey,
    pub amount: u64,
    pub status: WithdrawalStatus,
    pub requested_at: i64,
    pub approved_at: i64,
    pub completed_at: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl Withdrawal {
    pub const LEN: usize = 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1; // participant + amount + status + requested_at + approved_at + completed_at + nonce + bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum WithdrawalStatus {
    Pending,
    Approved,
    Completed,
    Rejected,
}

#[error_code]
pub enum ClearingError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid withdrawal status")]
    InvalidWithdrawalStatus,
}
