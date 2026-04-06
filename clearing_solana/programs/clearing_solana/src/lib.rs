use anchor_lang::prelude::*;

declare_id!("BNX6hQwS6qsF7o91ve3mEjLzQU7W276yvZUwgMfscn5t");

#[program]
pub mod clearing_solana {
    use anchor_lang::system_program::{self, Transfer};

    use super::*;

    pub fn init_clearing_state(ctx: Context<InitClearingState>) -> Result<()> {
        let clock = Clock::get()?;

        let state = &mut ctx.accounts.state;

        state.authority = ctx.accounts.authority.key();
        state.bump = ctx.bumps.state;
        state.session_interval_time = clock::SECONDS_PER_DAY * 7;
        state.total_participants = 0;
        state.total_sessions = 0;
        state.total_obligations = 0;
        state.fee_rate_bps = 0;
        state.update_timestamp = clock.unix_timestamp;

        Ok(())
    }

    pub fn init_admin(ctx: Context<InitAdmin>) -> Result<()> {
        let clock = Clock::get()?;

        let admin = &mut ctx.accounts.admin;
        let state = &mut ctx.accounts.state;

        state.super_admin = Some(ctx.accounts.authority.key());

        admin.authority = ctx.accounts.authority.key();
        admin.registration_timestamp = clock.unix_timestamp;
        admin.bump = ctx.bumps.admin;
        admin.user_type = UserType::Admin;
        admin.last_session_id = 0;
        admin.name = "super admin".into();
        admin.update_timestamp = clock.unix_timestamp;

        Ok(())
    }

    /// Method to create new obligation(from-to-amount)
    pub fn register_obligation(
        ctx: Context<RegisterObligation>,
        from: Pubkey,
        to: Pubkey,
        amount: u64,
        pool_id: u32,
        timestamp: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(from != to, ObligationError::FromToEquals);

        let obligation = &mut ctx.accounts.new_obligation;
        obligation.status = ObligationStatus::Created;
        obligation.from = from;
        obligation.to = to;
        obligation.amount = amount;
        obligation.timestamp = clock.unix_timestamp;
        obligation.session_id = None;
        obligation.bump = ctx.bumps.new_obligation;
        obligation.pool_id = pool_id;

        //  Try to push obligation to pool
        //  if failure - retry with next pool_id
        let pool = &mut ctx.accounts.pool;
        pool.add_obligation(obligation.key())?;

        //  Update system's state
        let state = &mut ctx.accounts.state;
        state.total_obligations = state
            .total_obligations
            .checked_add(1)
            .ok_or(CustomErrors::MathOverflow)?;

        let participant = &mut ctx.accounts.participant;
        participant.update_timestamp = clock.unix_timestamp;

        Ok(())
    }

    /// Method to decline obligation if 'from participant' disagree with conditions
    pub fn decline_obligation(
        ctx: Context<DeclineObligation>,
        from: Pubkey,
        to: Pubkey,
        timestamp: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        let obligation = &mut ctx.accounts.obligation;

        require!(
            obligation.status == ObligationStatus::Created,
            DeclineObligationError::InvalidStatus
        );

        obligation.status = ObligationStatus::Declined;

        let from_participant = &mut ctx.accounts.from_participant;
        from_participant.update_timestamp = clock.unix_timestamp;

        let pool = &mut ctx.accounts.pool;
        pool.remove_obligation(obligation.key())?;

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

    pub fn process_obligation(
        ctx: Context<ProcessObligation>,
        from: Pubkey,
        to: Pubkey,
        timestamp: i64,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        let state = &ctx.accounts.state;
        let session_id = session.id;

        require!(
            session.status == ClearingSessionStatus::Open,
            ClearingError::InvalidSessionStatus
        );

        let obligation = &mut ctx.accounts.obligation;
        require!(
            obligation.status == ObligationStatus::Created
                || obligation.status == ObligationStatus::Confirmed,
            ClearingError::InvalidObligationStatus
        );
        require!(
            obligation.session_id.is_none(),
            ClearingError::AlreadyProcessed
        );

        // Mark obligation as compeleted in that session
        obligation.session_id = Some(session_id);
        obligation.status = ObligationStatus::Netted;

        // Remove obligation from pool
        let pool = &mut ctx.accounts.pool;
        pool.remove_obligation(obligation.key())?;

        // Update from position
        let from_pos = &mut ctx.accounts.from_position;
        from_pos.net_amount = from_pos
            .net_amount
            .checked_sub(obligation.amount)
            .ok_or(CustomErrors::MathOverflow)?;

        //  Calculate new add fee and update total fee
        let add_fee_amount = state.calculate_fee(obligation.amount);
        from_pos.fee_amount = from_pos
            .fee_amount
            .checked_add(add_fee_amount)
            .ok_or(CustomErrors::MathOverflow)?;

        // Update to position
        let to_pos = &mut ctx.accounts.to_position;
        to_pos.net_amount = to_pos
            .net_amount
            .checked_add(obligation.amount)
            .ok_or(CustomErrors::MathOverflow)?;

        session.processed_count = session
            .processed_count
            .checked_add(1)
            .ok_or(CustomErrors::MathOverflow)?;

        Ok(())
    }

    pub fn finalize_clearing_session(ctx: Context<FinalizeClearingSession>) -> Result<()> {
        let clock = Clock::get()?;

        let session = &mut ctx.accounts.session;

        session.status = ClearingSessionStatus::Closed;
        session.closed_at = clock.unix_timestamp;

        Ok(())
    }

    pub fn start_clearing_session(
        ctx: Context<StartClearingSession>,
        total_obligations: u32,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Increment session_id
        let state = &mut ctx.accounts.state;
        state.total_sessions = state
            .total_sessions
            .checked_add(1)
            .ok_or(CustomErrors::MathOverflow)?;

        let session = &mut ctx.accounts.session;

        session.id = state.total_sessions;
        session.status = ClearingSessionStatus::Open;
        session.opened_at = clock.unix_timestamp;
        session.closed_at = 0;
        session.processed_count = 0;
        session.total_obligations = total_obligations;
        session.bump = ctx.bumps.session;

        Ok(())
    }

    /// Method that would be called when all the extisting pools are full.
    /// This method would be called by last participant,
    /// He will see a choice to pay for new pool, or wait till some pool is free
    /// Only after his confirmation to pay for pool this method is invoked
    pub fn create_new_pool(ctx: Context<CreateNewPool>, last_pool_id: u32) -> Result<()> {
        let clock = Clock::get()?;

        let last_pool = &mut ctx.accounts.last_pool;

        //  Configure new pool
        let new_pool = &mut ctx.accounts.new_pool;
        new_pool.authority = last_pool.authority;
        new_pool.id = last_pool_id + 1;
        new_pool.obligations = [Pubkey::default(); ObligationPool::MAX_OBLIGATIONS];
        new_pool.occupied_count = 0;
        new_pool.next_pool = None;
        new_pool.bump = ctx.bumps.new_pool;

        //  Link new pool with last
        last_pool.next_pool = Some(new_pool.key());

        emit!(PoolCreated {
            id: last_pool_id + 1,
            timestamp: clock.unix_timestamp
        });

        Ok(())
    }

    /// Method to create pool manager(dispatcher)
    pub fn create_pool_manager(ctx: Context<CreatePoolManager>) -> Result<()> {
        let root_pool = &mut ctx.accounts.root_pool;
        root_pool.id = 0;
        root_pool.authority = ctx.accounts.authority.key();
        root_pool.obligations = [Pubkey::default(); ObligationPool::MAX_OBLIGATIONS];
        root_pool.occupied_count = 0;
        root_pool.next_pool = None;
        root_pool.bump = ctx.bumps.root_pool;

        let pool_manager = &mut ctx.accounts.pool_manager;
        pool_manager.authority = ctx.accounts.authority.key();
        pool_manager.root_pool = ctx.accounts.root_pool.key();
        pool_manager.bump = ctx.bumps.pool_manager;

        Ok(())
    }

    /// Method to init escrow account
    /// Must be invoked by admin
    pub fn init_escrow(ctx: Context<InitEscrow>) -> Result<()> {
        let clock = Clock::get()?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.authority = ctx.accounts.authority.key();
        escrow.total_fees = 0;
        escrow.bump = ctx.bumps.escrow;

        emit!(EscrowInitialized {
            admin: ctx.accounts.authority.key(),
            escrow: escrow.key(),
            timestamp: clock.unix_timestamp
        });

        Ok(())
    }

    /// Method to register new participant
    /// NameBytes is actual username and NameHash is just for PDA calculation
    pub fn register_participant(
        ctx: Context<RegisterParticipant>,
        name_hash: [u8; 32],
        name: String,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Save name hash in Registry
        let registry = &mut ctx.accounts.name_registry;
        registry.participant = ctx.accounts.authority.key();
        registry.bump = ctx.bumps.name_registry;

        // Save participant
        let participant = &mut ctx.accounts.new_participant;
        participant.authority = ctx.accounts.authority.key();
        participant.user_type = UserType::Participant;
        participant.registration_timestamp = clock.unix_timestamp;
        participant.update_timestamp = clock.unix_timestamp;
        participant.last_session_id = 0;
        participant.name = name;
        participant.bump = ctx.bumps.new_participant;

        // Update system state
        let state = &mut ctx.accounts.state;
        state.total_participants = state
            .total_participants
            .checked_add(1)
            .ok_or(CustomErrors::MathOverflow)?;

        msg!("Participant created: {}", participant.key());

        Ok(())
    }

    pub fn settle_position(
        ctx: Context<SettlePosition>,
        session_id: u64,
        to: Pubkey,
        timestamp: i64,
    ) -> Result<()> {
        let net_position = &mut ctx.accounts.net_position;
        let obligation = &mut ctx.accounts.obligation;

        require!(
            net_position.net_amount != 0,
            SettlePositionError::ZeroPosition
        );

        //  Create instruction
        let transfer_instruction = Transfer {
            from: ctx.accounts.authority.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_instruction,
        );

        //  Payment of net position
        system_program::transfer(cpi_ctx, net_position.fee_amount)?;

        //  Update net position amount
        net_position.net_amount = net_position
            .net_amount
            .checked_sub(obligation.amount)
            .ok_or(CustomErrors::MathOverflow)?;

        obligation.status = ObligationStatus::Netted;

        msg!("Position {} settled", net_position.key());

        Ok(())
    }

    /// Method to get configrmation by 'from participant' (the one that will have to pay obligation).
    pub fn confirm_obligation(
        ctx: Context<ConfirmObligation>,
        from: Pubkey,
        to: Pubkey,
        timestamp: i64,
    ) -> Result<()> {
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

        msg!("Obligation {} confirmed", obligation.key());

        Ok(())
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

    pub fn update_participant_last_session_id(
        ctx: Context<UpdateParticipantLastSessionId>,
        participant: Pubkey,
    ) -> Result<()> {
        let state = &ctx.accounts.state;

        let participant = &mut ctx.accounts.participant;

        require!(
            participant.last_session_id < state.total_sessions,
            SessionIdError::SessionIdNotGreater
        );

        participant.last_session_id = state.total_sessions;

        Ok(())
    }

    /// Method to change user's type
    /// Can only be invoked by admin
    pub fn update_user_type(
        ctx: Context<UpdateUserType>,
        participant: Pubkey,
        user_type: UserType,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let target = &mut ctx.accounts.target_participant;
        let admin = &ctx.accounts.admin;

        require!(
            target.key() != admin.key(),
            ParticipantError::CannotChangeSelf
        );

        target.user_type = user_type;
        target.update_timestamp = clock.unix_timestamp;

        msg!("User type updated for {} to {:?}", target.key(), user_type);

        Ok(())
    }

    /// Method to pay fee of the session
    pub fn pay_fee(ctx: Context<PayFee>, session_id: u64) -> Result<()> {
        let clock = Clock::get()?;

        let escrow = &mut ctx.accounts.escrow;
        let participant = &mut ctx.accounts.participant;
        let net_position = &mut ctx.accounts.net_position;

        require!(net_position.fee_amount > 0, PayFeeError::InvalidFeeAccount);

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
        system_program::transfer(cpi_ctx, net_position.fee_amount)?;

        //  Update state
        net_position.status = NetPositionStatus::FeePaid;
        escrow.total_fees = escrow
            .total_fees
            .checked_add(net_position.fee_amount)
            .ok_or(CustomErrors::MathOverflow)?;

        participant.update_timestamp = clock.unix_timestamp;

        emit!(FeePaid {
            participant: ctx.accounts.authority.key(),
            session_id,
            amount: net_position.fee_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Method to update fee rate,
    /// must be invoked by admin
    pub fn update_fee_rate(ctx: Context<UpdateFeeRate>, new_rate_bps: u64) -> Result<()> {
        let clock = Clock::get()?;

        require!(new_rate_bps <= 10000, UpdateFeeRateError::InvalidRate);

        let state = &mut ctx.accounts.state;
        let admin = &mut ctx.accounts.admin;
        let old_rate_bps = state.fee_rate_bps;

        state.fee_rate_bps = new_rate_bps;
        state.update_timestamp = clock.unix_timestamp;
        admin.update_timestamp = clock.unix_timestamp;

        emit!(FeeRateUpdated {
            admin: admin.authority,
            old_rate: old_rate_bps,
            new_rate: new_rate_bps,
            timestamp: clock.unix_timestamp
        });

        Ok(())
    }

    /// Method to update fee rate,
    /// must be invoked by admin
    pub fn update_session_interval_time(
        ctx: Context<UpdateSessionIntervalTime>,
        new_interval_time: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(
            new_interval_time <= clock::SECONDS_PER_DAY * 30,
            UpdateSessionIntervalTimeError::InvalidRate
        );

        let state = &mut ctx.accounts.state;
        let admin = &mut ctx.accounts.admin;
        let old_interval_time = state.session_interval_time;

        state.session_interval_time = new_interval_time;
        state.update_timestamp = clock.unix_timestamp;
        admin.update_timestamp = clock.unix_timestamp;

        emit!(SessionIntervalTimeUpdated {
            admin: admin.authority,
            old_interval_time: old_interval_time,
            new_interval_time: new_interval_time,
            timestamp: clock.unix_timestamp
        });

        Ok(())
    }

    /// Method must be called by both participants of obligation.
    /// Each will interact only with his 'cancel flag'.
    /// When both flags are true - only then obligation is considered as 'Canceled'.
    pub fn cancel_obligation(
        ctx: Context<CancelObligation>,
        from: Pubkey,
        to: Pubkey,
        timestamp: i64,
    ) -> Result<()> {
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
            require!(!obligation.to_cancel, CancelObligationError::Duplication);
            obligation.to_cancel = true;

            let to_participant = &mut ctx.accounts.to_participant;
            to_participant.update_timestamp = clock.unix_timestamp;

            msg!("Obligation {} cancelled by creditor", obligation.key());
        }

        //  Cancel by 'from_participant'
        if authority == ctx.accounts.from_participant.authority {
            require!(!obligation.from_cancel, CancelObligationError::Duplication);
            obligation.from_cancel = true;

            let from_participant = &mut ctx.accounts.from_participant;
            from_participant.update_timestamp = clock.unix_timestamp;

            msg!("Obligation {} cancelled by debitor", obligation.key());
        }

        //  Check for both confirmations
        if obligation.to_cancel && obligation.from_cancel {
            obligation.status = ObligationStatus::Cancelled;

            //  Remove obligation from pool
            let pool = &mut ctx.accounts.pool;

            pool.remove_obligation(obligation.key())?;

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
}

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
        constraint = participant.authority == authority.key() @ CustomErrors::Unauthorized
    )]
    pub participant: Account<'info, Participant>,

    #[account(
        mut,
        seeds = [b"session", &session_id.to_le_bytes()], 
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        mut,
        seeds = [b"position", session.key().as_ref(), participant.key().as_ref()],
        bump,
        constraint = net_position.status != NetPositionStatus::FeePaid @ PayFeeError::AlreadyPaid,
    )]
    pub net_position: Account<'info, NetPosition>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum PayFeeError {
    InvalidFeeAccount,
    SessionIdMismatch,
    InvalidFeeAmount,
    AlreadyPaid,
}

#[account]
pub struct ClearingEngine {
    pub authority: Pubkey,
    pub bump: u8,
}

impl ClearingEngine {
    pub const LEN: usize = 32 + // authority
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"engine"], &crate::ID)
    }
}

#[error_code]
pub enum ClearingEngineError {
    #[msg("Unauthorized")]
    Unauthorized,
}

/// Object of session, maily used for statistics
#[account]
pub struct ClearingSession {
    pub id: u64,
    pub status: ClearingSessionStatus,
    pub opened_at: i64,
    pub closed_at: i64,
    pub total_obligations: u32,
    pub processed_count: u32,
    pub bump: u8,
}

impl ClearingSession {
    pub const LEN: usize = 8 +  // id
        1 +  // status
        8 +  // opened_at
        8 +  // closed_at
        4 +  // total_obligations
        4 +  // processed_count
        1; // bump

    pub fn pda(session_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"session", &session_id.to_le_bytes()], &crate::ID)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ClearingSessionStatus {
    Open,
    Closed,
    Cancelled,
    Failed,
}

/// Result of netting sessions
#[account]
pub struct NettingSessionResult {
    pub id: u64,
    pub session_id: u64,
    pub amount: u64,
    pub counter_agent: Pubkey,
}

/// Account for getting commissions from users of system
/// Only admin can create this account (he is the owner)
#[account]
pub struct Escrow {
    pub authority: Pubkey,
    pub total_fees: u64,
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 32 + // authority
        8 + // total_fess
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"escrow"], &crate::ID)
    }
}

/// Account for saving users' names,
/// uses can occupy name, so next will see it is used
#[account]
pub struct NameRegistry {
    pub participant: Pubkey,
    pub bump: u8,
}

impl NameRegistry {
    pub const LEN: usize = 32 + // participant
        1; // bump

    pub fn pda(name_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"name_registry", name_hash.as_ref()], &crate::ID)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum NetPositionStatus {
    None, // start: no fee payment
    FeePaid,
    Done, // means fee paid + creditor transfered net amount
}

#[account]
pub struct NetPosition {
    pub status: NetPositionStatus,
    pub session_id: u64,
    pub creditor: Pubkey,
    pub debitor: Pubkey,
    pub net_amount: u64,
    pub fee_amount: u64,
    pub bump: u8,
}

impl NetPosition {
    pub const LEN: usize = 1 + // status
        8 + // session_id
        32 + // creditor
        32 + // debitor
        8 + // net_amount
        8 + // fee_amount
        1; // bump
}

use anchor_lang::prelude::clock::UnixTimestamp;

/// Obligation from participant A to participant B
/// After creation it will be sticked to Pool X
/// session_id is 0 by default, but will be assigned to X on clearing session
/// from and to cancel flags are for cancelation before clearing session,
/// after cancelation obligation will be removed from Pool
#[account]
pub struct Obligation {
    pub status: ObligationStatus,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub session_id: Option<u64>, // default None (no session_id is linked at first)
    pub from_cancel: bool,
    pub to_cancel: bool,
    pub pool_id: u32,
    pub bump: u8,
}

impl Obligation {
    pub const LEN: usize = 1 +  // status
        32 + // from
        32 + // to
        8 + // amount
        8 + // timestamp
        16 + // session_id
        1 + // from_cancel
        1 + // to_cancel
        4 + // pool_id
        1; // bump

    // TODO: OR linked-list to connect from-to-session_id obligations OR from-to-timestamp
    pub fn pda(from: Pubkey, to: Pubkey, timestamp: UnixTimestamp) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"obligation",
                from.as_ref(),
                to.as_ref(),
                &timestamp.to_le_bytes(),
            ],
            &crate::ID,
        )
    }

    pub fn set_session(&mut self, session_id: u64) {
        self.session_id = Some(session_id);
    }

    pub fn update_status(&mut self, status: ObligationStatus) {
        self.status = status;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ObligationStatus {
    Created,
    Confirmed,
    Declined,
    Netted,
    Cancelled,
}

#[error_code]
pub enum ObligationError {
    #[msg("From and To cannot be the same")]
    FromToEquals,
}

/// Pool to keep obligations in one place,
/// has references to neighbour Pools
#[account]
pub struct ObligationPool {
    pub authority: Pubkey,
    pub id: u32,
    pub obligations: [Pubkey; Self::MAX_OBLIGATIONS],
    pub occupied_count: u8,
    pub next_pool: Option<Pubkey>,
    pub bump: u8,
}

impl ObligationPool {
    pub const MAX_OBLIGATIONS: usize = 50;
    pub const LEN: usize = 32 + // authority
        4 + // pool_id
        32 * Self::MAX_OBLIGATIONS + // obligations array
        1 + // occupied_count
        33 + // next_pool (Option<Pubkey>)
        1; // bump

    /// Returns id of Pool
    pub fn add_obligation(&mut self, obligation_pubkey: Pubkey) -> Result<()> {
        for i in 0..Self::MAX_OBLIGATIONS {
            if self.obligations[i] == Pubkey::default() {
                self.obligations[i] = obligation_pubkey;
                self.occupied_count
                    .checked_add(1)
                    .ok_or(CustomErrors::MathOverflow)?;

                return Ok(());
            }
        }

        Err(PoolError::PoolFull.into())
    }

    pub fn remove_obligation_nth(&mut self, index: usize) -> Result<()> {
        require!(index < Self::MAX_OBLIGATIONS, PoolError::InvalidIndex);
        require!(
            self.obligations[index] != Pubkey::default(),
            PoolError::SlotEmpty
        );

        // self.occupied[index] = false;
        self.obligations[index] = Pubkey::default();
        self.occupied_count
            .checked_sub(1)
            .ok_or(CustomErrors::MathOverflow)?;

        Ok(())
    }

    pub fn remove_obligation(&mut self, obligation: Pubkey) -> Result<()> {
        for i in 0..Self::MAX_OBLIGATIONS {
            if self.obligations[i] == obligation {
                self.obligations[i] = Pubkey::default();
                self.occupied_count
                    .checked_sub(1)
                    .ok_or(CustomErrors::MathOverflow)?;

                return Ok(());
            }
        }

        Err(PoolError::NotFound.into())
    }

    pub fn is_full(&self) -> bool {
        self.occupied_count == Self::MAX_OBLIGATIONS as u8
    }

    pub fn pda(index: u32) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"pool", &index.to_le_bytes()], &crate::ID)
    }
}

#[error_code]
pub enum PoolError {
    #[msg("Pool is full")]
    PoolFull,
    #[msg("Invalid index")]
    InvalidIndex,
    #[msg("Slot is empty")]
    SlotEmpty,
    #[msg("Obligation not found")]
    NotFound,
}

/// Participant of system, can be Admin, Participant
#[account]
pub struct Participant {
    pub authority: Pubkey,
    pub user_type: UserType,
    pub registration_timestamp: i64,
    pub update_timestamp: i64,
    pub last_session_id: u64,
    pub name: String,
    pub bump: u8,
}

impl Participant {
    pub const MAX_NAME_LEN: usize = 32;

    pub const LEN: usize = 32 + // authority
        1 + // user_type
        8 + // registration_timestamp
        8 + // update_timestamp
        8 + // last_session_id
        4 + 32 + // name
        1; // bump

    pub fn pda(pubkey: Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"participant", pubkey.as_ref()], &crate::ID)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum UserType {
    Participant,
    Admin,
    Officer,
}

#[error_code]
pub enum ParticipantError {
    #[msg("Name too long (max 32 characters)")]
    NameTooLong,

    #[msg("No permission to access")]
    Forbidden,

    #[msg("Wrong authority")]
    WrongAuthority,

    #[msg("Cannot change own user type")]
    CannotChangeSelf,
}

/// Main account of Pools, have reference to Root Pool,
/// which is the main pool
#[account]
pub struct PoolManager {
    pub authority: Pubkey,
    pub root_pool: Pubkey,
    pub bump: u8,
}

impl PoolManager {
    pub const LEN: usize = 32 + // authority
        32 + // root_pool
        1; // bump
}

/// Account for general state of system
#[account]
pub struct ClearingState {
    pub authority: Pubkey,
    pub super_admin: Option<Pubkey>,
    pub total_sessions: u64,
    pub total_participants: u64,
    pub total_obligations: u64,
    pub session_interval_time: u64,
    pub fee_rate_bps: u64,
    pub update_timestamp: i64,
    pub bump: u8,
}

impl ClearingState {
    pub const LEN: usize = 32 + // authority
        33 + // super_admin
        8 + // total_sessions
        8 + // total_participants
        8 + // total_obligations
        8 + // session_interval_time
        8 + // fee_rate_bps
        8 + // update_timestamp
        1; // bump

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"state"], &crate::ID)
    }

    pub fn fee_rate_as_percent(&self) -> f64 {
        self.fee_rate_bps as f64 / 100.0
    }

    pub fn calculate_fee(&self, amount: u64) -> u64 {
        amount * self.fee_rate_bps / 10000
    }
}

#[derive(Accounts)]
pub struct UpdateFeeRate<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ UpdateFeeRateError::Forbidden,
        constraint = admin.authority == authority.key() @ UpdateFeeRateError::Unauthorized
    )]
    pub admin: Account<'info, Participant>,

    #[account(
            mut,
            seeds = [b"state"],
            bump
        )]
    pub state: Account<'info, ClearingState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum UpdateFeeRateError {
    NegativeRate,
    InvalidRate,
    Unauthorized,
    Forbidden,
}

#[derive(Accounts)]
pub struct UpdateSessionIntervalTime<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ UpdateFeeRateError::Forbidden,
        constraint = admin.authority == authority.key() @ UpdateFeeRateError::Unauthorized
    )]
    pub admin: Account<'info, Participant>,

    #[account(
            mut,
            seeds = [b"state"],
            bump
        )]
    pub state: Account<'info, ClearingState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum UpdateSessionIntervalTimeError {
    NegativeRate,
    InvalidRate,
    Unauthorized,
    Forbidden,
}

use anchor_lang::prelude::{program::invoke, system_instruction::transfer};

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

#[derive(Accounts)]
pub struct InitClearingState<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ClearingState::LEN,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct CancelObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = from_participant.authority == from @ CancelObligationError::InvalidFromParticipant
    )]
    pub from_participant: Box<Account<'info, Participant>>,

    #[account(
        seeds = [b"participant", to.as_ref()],
        bump,
        constraint = to_participant.authority == to @ CancelObligationError::InvalidToParticipant
    )]
    pub to_participant: Box<Account<'info, Participant>>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump,
        constraint = obligation.from == from @ CancelObligationError::Forbidden,
        constraint = obligation.to == to @ CancelObligationError::Forbidden,
    )]
    pub obligation: Box<Account<'info, Obligation>>,

    #[account(
        mut,
        seeds = [b"pool", &obligation.pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Box<Account<'info, ObligationPool>>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
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

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct ConfirmObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = authority.key() == from @ CustomErrors::Unauthorized,
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
        constraint = obligation.from == from @ CustomErrors::Forbidden,
        constraint = obligation.to == to @ CustomErrors::Forbidden,
    )]
    pub obligation: Account<'info, Obligation>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ConfirmObligationError {
    InvalidStatus,
    InvalidToParticipant,
    InvalidFromParticipant,
}

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, amount: u64, pool_id: u32, timestamp: i64)]
pub struct RegisterObligation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Box<Account<'info, ClearingState>>,

    #[account(
        init,
        payer = authority,
        space = 8 + Obligation::LEN,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump
    )]
    pub new_obligation: Box<Account<'info, Obligation>>,

    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub participant: Box<Account<'info, Participant>>,

    #[account(
        mut,
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Box<Account<'info, ObligationPool>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct DeclineObligation<'info> {
    #[account(
        mut,
        seeds = [b"participant", from.as_ref()],
        bump,
        constraint = authority.key() == from @ CustomErrors::Unauthorized,
        constraint = from_participant.authority == from @ DeclineObligationError::InvalidFromParticipant
    )]
    pub from_participant: Box<Account<'info, Participant>>,

    #[account(
        seeds = [b"participant", to.as_ref()],
        bump,
        constraint = to_participant.authority == to @ DeclineObligationError::InvalidToParticipant
    )]
    pub to_participant: Box<Account<'info, Participant>>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), &timestamp.to_le_bytes()],
        bump,
        constraint = obligation.from == from @ CustomErrors::Forbidden,
        constraint = obligation.to == to @ CustomErrors::Forbidden,
    )]
    pub obligation: Box<Account<'info, Obligation>>,

    #[account(
        mut,
        seeds = [b"pool", &obligation.pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Box<Account<'info, ObligationPool>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum DeclineObligationError {
    InvalidStatus,
    InvalidToParticipant,
    InvalidFromParticipant,
}

#[derive(Accounts)]
#[instruction(from: Pubkey, to: Pubkey, timestamp: i64)]
pub struct ProcessObligation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Box<Account<'info, ClearingState>>,

    #[account(
        mut,
        seeds = [b"session", &state.total_sessions.to_le_bytes()], 
        bump = session.bump
    )]
    pub session: Box<Account<'info, ClearingSession>>,

    #[account(
        mut,
        seeds = [b"obligation", from.as_ref(), to.as_ref(), timestamp.to_le_bytes().as_ref()],
        bump
    )]
    pub obligation: Box<Account<'info, Obligation>>,

    #[account(
        mut,
        seeds = [b"pool", obligation.pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, ObligationPool>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + NetPosition::LEN,
        seeds = [b"position", session.key().as_ref(), obligation.from.as_ref()], 
        bump
    )]
    pub from_position: Box<Account<'info, NetPosition>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + NetPosition::LEN,
        seeds = [b"position", session.key().as_ref(), obligation.to.as_ref()], 
        bump
    )]
    pub to_position: Box<Account<'info, NetPosition>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ClearingError {
    AlreadyProcessed,
    InvalidSessionStatus,
    InvalidObligationStatus,
}

#[derive(Accounts)]
pub struct FinalizeClearingSession<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
            init,
            payer = authority,
            space = 8 + ClearingSession::LEN,
            seeds = [b"session", state.total_sessions.to_le_bytes().as_ref()],
            bump
        )]
    pub session: Account<'info, ClearingSession>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartClearingSession<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
            init,
            payer = authority,
            space = 8 + ClearingSession::LEN,
            seeds = [b"session", (state.total_sessions + 1).to_le_bytes().as_ref()],
            bump
        )]
    pub session: Account<'info, ClearingSession>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(last_pool_id: u32)]
pub struct CreateNewPool<'info> {
    #[account(
        seeds = [b"pool", &last_pool_id.to_le_bytes()],
        bump,
        constraint = last_pool.next_pool.is_none() @  CreateNewPoolError::PoolNotLast
    )]
    pub last_pool: Box<Account<'info, ObligationPool>>,

    #[account(
        init,
        payer = authority,
        space = 8 + ObligationPool::LEN,
        seeds = [b"pool", &(last_pool.id+1).to_le_bytes()],
        bump
    )]
    pub new_pool: Box<Account<'info, ObligationPool>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePoolManager<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ObligationPool::LEN,
        seeds = [b"pool", &(0u32).to_le_bytes()],
        bump
    )]
    pub root_pool: Box<Account<'info, ObligationPool>>,

    #[account(
            init,
            payer = authority,
            space = 8 + PoolManager::LEN,
            seeds = [b"pool_manager"],
            bump
        )]
    pub pool_manager: Account<'info, PoolManager>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum CreateNewPoolError {
    PoolNotLast,
}

#[derive(Accounts)]
pub struct InitEscrow<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Escrow::LEN,
        seeds = [b"escrow"],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ CustomErrors::Forbidden,
        constraint = authority.key() == admin.authority @ CustomErrors::Unauthorized
    )]
    pub admin: Account<'info, Participant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitAdmin<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump,
        constraint = state.super_admin.is_none() @ CustomErrors::AdminAlreadyExists
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        init,
        payer = authority,
        space = 8 + Participant::LEN,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub admin: Account<'info, Participant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name_hash: [u8; 32])]
pub struct RegisterParticipant<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump,
    )]
    pub state: Account<'info, ClearingState>,

    #[account(
        init,
        payer = authority,
        space = 8 + Participant::LEN,
        seeds = [b"participant", authority.key().as_ref()],
        bump
    )]
    pub new_participant: Account<'info, Participant>,

    #[account(
        init,
        payer = authority,
        space = 8 + NameRegistry::LEN,
        seeds = [b"name_registry", name_hash.as_ref()],
        bump
    )]
    pub name_registry: Account<'info, NameRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(session_id: u64, to: Pubkey, timestamp: i64)]
pub struct SettlePosition<'info> {
    #[account(
        mut,
        seeds = [b"session", session_id.to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, ClearingSession>,

    #[account(
        mut,
        seeds = [b"position", session.key().as_ref(), authority.key().as_ref()],
        bump,
        constraint = net_position.status == NetPositionStatus::FeePaid @ SettlePositionError::FeeNotPaid,
        constraint = net_position.net_amount > 0 @ SettlePositionError::NoNeedInPayment
    )]
    pub net_position: Account<'info, NetPosition>,

    #[account(
        mut,
        seeds = [b"obligation", authority.key().as_ref(), to.as_ref(), timestamp.to_le_bytes().as_ref()],
        bump
    )]
    pub obligation: Account<'info, Obligation>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    /// CHECK: recipient does not require validation because it only receives SOL
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum SettlePositionError {
    FeeNotPaid,
    NoNeedInPayment,
    ZeroPosition,
}

#[derive(Accounts)]
#[instruction(participant: Pubkey)]
pub struct UpdateParticipantLastSessionId<'info> {
    #[account(
        mut,
        seeds = [b"participant", participant.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,

    #[account(
            seeds = [b"state"],
            bump
        )]
    pub state: Account<'info, ClearingState>,

    #[account(
                seeds = [b"engine"],
                bump,
                constraint = clearing_engine.authority == authority.key() @ ClearingEngineError::Unauthorized
            )]
    pub clearing_engine: Account<'info, ClearingEngine>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum SessionIdError {
    #[msg("Session Id must be greater than previous")]
    SessionIdNotGreater,
}

#[derive(Accounts)]
#[instruction(participant: Pubkey, user_type: UserType)]
pub struct UpdateUserType<'info> {
    #[account(
        mut,
        seeds = [b"participant", authority.key().as_ref()],
        bump,
        constraint = admin.user_type == UserType::Admin @ CustomErrors::Forbidden,
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

#[event]
pub struct EscrowInitialized {
    pub admin: Pubkey,
    pub escrow: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct FeePaid {
    pub participant: Pubkey,
    pub session_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeWithdrawed {
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeRateUpdated {
    pub admin: Pubkey,
    pub old_rate: u64,
    pub new_rate: u64,
    pub timestamp: i64,
}

#[event]
pub struct SessionIntervalTimeUpdated {
    pub admin: Pubkey,
    pub old_interval_time: u64,
    pub new_interval_time: u64,
    pub timestamp: i64,
}

#[event]
pub struct ObligationCreated {
    pub obligation: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ObligationConfirmed {
    pub obligation: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ObligationDeclined {
    pub obligation: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ObligationCancelled {
    pub obligation: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ObligationNetted {
    pub obligation: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ParticipantRegistered {
    pub pariticipant: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PoolCreated {
    pub id: u32,
    pub timestamp: i64,
}

#[error_code]
pub enum CustomErrors {
    #[msg("Math overflow error")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Forbidden")]
    Forbidden,
    #[msg("Empty name")]
    EmptyName,
    AdminAlreadyExists,
}

#[error_code]
pub enum WithdrawFeeError {
    Unauthorized,
    Forbidden,
    InsufficientBalance,
    InsufficientFees,
    MathOverflow,
}
