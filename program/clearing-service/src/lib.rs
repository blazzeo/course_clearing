use std::fmt::Debug;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("6N3d12ynnUC5r8pLbr95vmFQMzp6prcKRKd5SyZYWjkw");

#[program]
pub mod clearing_service {
    use super::*;

    /// Инициализация аккаунта участника для работы со средствами
    pub fn initialize_participant(ctx: Context<InitializeParticipant>) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        participant.authority = ctx.accounts.authority.key();
        participant.balance = 0;
        participant.outstanding_fees = 0;
        participant.is_blocked = false;
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

        // Сначала гасим долги, если они есть
        let debt = participant.outstanding_fees;
        if debt > 0 && amount >= debt as u64 {
            // Полное погашение долга
            participant.outstanding_fees = 0;
            participant.is_blocked = false;
            escrow.system_fees_collected += debt;

            // Оставшаяся сумма идет на баланс
            let remaining = amount - debt as u64;
            participant.balance += remaining as i64;
            escrow.total_locked += remaining as i64;

            msg!(
                "Debt repaid and funds deposited: {} lamports (repaid: {}, deposited: {}) by {}",
                amount,
                debt,
                remaining,
                ctx.accounts.authority.key()
            );
        } else if debt > 0 && amount < debt as u64 {
            // Частичное погашение долга
            let repaid = amount as i64;
            participant.outstanding_fees -= repaid;
            escrow.system_fees_collected += repaid;

            // Проверяем, полностью ли погашен долг
            if participant.outstanding_fees <= 0 {
                participant.outstanding_fees = 0;
                participant.is_blocked = false;
            }

            msg!(
                "Partial debt repayment: {} lamports repaid, {} remaining by {}",
                repaid,
                participant.outstanding_fees,
                ctx.accounts.authority.key()
            );
        } else {
            // Обычный депозит без долгов
            participant.balance += amount as i64;
            escrow.total_locked += amount as i64;

            msg!(
                "Funds deposited: {} lamports by {}",
                amount,
                ctx.accounts.authority.key()
            );
        }

        Ok(())
    }

    /// Оплата комиссии с депозита на escrow
    pub fn collect_fee(ctx: Context<CollectFee>, amount: u64, reason: String) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        let escrow = &mut ctx.accounts.escrow;

        // Проверяем, что участник сам подписывает комиссию
        require!(
            participant.authority == ctx.accounts.authority.key(),
            ClearingError::Unauthorized
        );

        // Проверяем достаточность средств (упрощенная система без долгов)
        require!(
            participant.balance >= amount as i64,
            ClearingError::InsufficientFunds
        );

        // Списываем комиссию с депозита
        participant.balance -= amount as i64;
        escrow.system_fees_collected += amount as i64;

        msg!(
            "Fee paid: {} lamports for {} by {}",
            amount,
            reason,
            participant.authority
        );

        Ok(())
    }

    /// Погашение долга по комиссиям
    pub fn repay_outstanding_fees(ctx: Context<RepayFees>) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        let escrow = &mut ctx.accounts.escrow;
        let fee_debt = participant.outstanding_fees;

        require!(fee_debt > 0, ClearingError::NoOutstandingFees);

        // FIX: Используем CPI Transfer вместо прямого вычитания лампортов
        let transfer_ix = system_instruction::transfer(
            &ctx.accounts.authority.key(),
            &escrow.key(),
            fee_debt as u64,
        );

        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(), // Не забудьте добавить System Program в структуру
            ],
        )?;

        // // Перевод средств на системный escrow
        // **ctx
        //     .accounts
        //     .authority
        //     .to_account_info()
        //     .try_borrow_mut_lamports()? -= fee_debt as u64;
        // **escrow.to_account_info().try_borrow_mut_lamports()? += fee_debt as u64;

        // Обновляем системные комиссии и долг участника
        escrow.system_fees_collected += fee_debt;
        participant.outstanding_fees = 0;
        participant.is_blocked = false;

        msg!(
            "Outstanding fees repaid: {} lamports by {}",
            fee_debt,
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
        require!(!participant.is_blocked, ClearingError::ParticipantBlocked);
        require!(
            participant.outstanding_fees == 0,
            ClearingError::ParticipantBlocked
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
        escrow.system_fees_collected = 0;
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
pub struct CollectFee<'info> {
    #[account(
        mut,
        seeds = [b"participant", participant.authority.as_ref(), &[1]],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [b"escrow"],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RepayFees<'info> {
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
    pub outstanding_fees: i64, // Невзысканные комиссии (долг)
    pub is_blocked: bool,      // Флаг блокировки за долги
    pub bump: u8,
    pub withdrawal_nonce: u64,
}

impl Participant {
    pub const LEN: usize = 32 + 8 + 8 + 1 + 1 + 8; // authority + balance + outstanding_fees + is_blocked + bump + withdrawal_nonce
}

#[account]
pub struct Escrow {
    pub authority: Pubkey,
    pub total_locked: i64,
    pub system_fees_collected: i64, // Собранные системные комиссии
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 32 + 8 + 8 + 1; // authority + total_locked + system_fees_collected + bump
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
    #[msg("Participant is blocked due to outstanding fees")]
    ParticipantBlocked,
    #[msg("No outstanding fees to repay")]
    NoOutstandingFees,
}
