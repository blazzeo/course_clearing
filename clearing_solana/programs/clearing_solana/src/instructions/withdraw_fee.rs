use anchor_lang::prelude::{program::invoke, system_instruction::transfer, *};

use crate::{custom_accounts::Escrow, events::fees::FeeWithdrawed};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct WithdrawFee<'info> {
    #[account(
        mut,
        seeds = [b"escrow"],
        bump,
        constraint = escrow.authority == authority.key() @ WithdrawFeeError::Forbidden
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Method to Withdraw fee, can be invoked only by owner of escrow account(admin)
pub fn withdraw_fee(ctx: Context<WithdrawFee>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;

    {
        let escrow = &mut ctx.accounts.escrow;

        // Проверка что сумма не превышает баланс escrow
        let escrow_balance = **escrow.to_account_info().lamports.borrow();
        require!(
            escrow_balance >= amount,
            WithdrawFeeError::InsufficientBalance
        );

        // Проверка что не пытаемся вывести больше чем собрано
        require!(
            escrow.total_fees >= amount,
            WithdrawFeeError::InsufficientFees
        );
    }

    let transfer_instruction = transfer(
        &ctx.accounts.escrow.key(),
        &ctx.accounts.authority.key(),
        amount,
    );

    invoke(
        &transfer_instruction,
        &[
            ctx.accounts.escrow.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    let escrow = &mut ctx.accounts.escrow;

    escrow
        .total_fees
        .checked_sub(amount)
        .ok_or(WithdrawFeeError::MathOverflow)?;

    emit!(FeeWithdrawed {
        amount,
        timestamp: clock.unix_timestamp
    });

    Ok(())
}

#[error_code]
pub enum WithdrawFeeError {
    Unauthorized,
    Forbidden,
    InsufficientBalance,
    InsufficientFees,
    MathOverflow,
}
