use anchor_lang::prelude::*;

/// Pool to keep obligations in one place,
/// has references to neighbour Pools
#[account]
pub struct ObligationPool {
    pub authority: Pubkey,
    pub id: u32,
    pub obligations: [Pubkey; 100],
    pub occupied: [bool; 100],
    pub occupied_count: u8,
    pub next_pool: Option<Pubkey>,
    pub prev_pool: Option<Pubkey>,
    pub bump: u8,
}

impl ObligationPool {
    pub const MAX_OBLIGATIONS: usize = 100;
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        4 + // pool_id
        32 * Self::MAX_OBLIGATIONS + // obligations array
        1 * Self::MAX_OBLIGATIONS + // occupied array
        1 + // occupied_count
        33 + // next_pool (Option<Pubkey>)
        33 + // prev_pool (Option<Pubkey>)
        1; // bump

    /// Returns id of Pool
    pub fn add_obligation(&mut self, obligation_pubkey: Pubkey) -> Result<u32> {
        for i in 0..Self::MAX_OBLIGATIONS {
            if !self.occupied[i] {
                self.occupied[i] = true;
                self.obligations[i] = obligation_pubkey;
                self.occupied_count
                    .checked_add(1)
                    .ok_or(ObligationPoolError::MathOverflow)?;

                return Ok(self.id);
            }
        }

        Err(ObligationPoolError::PoolFull.into())
    }

    pub fn remove_obligation_nth(&mut self, index: usize) -> Result<()> {
        require!(
            index < Self::MAX_OBLIGATIONS,
            ObligationPoolError::InvalidIndex
        );
        require!(self.occupied[index] == true, ObligationPoolError::SlotEmpty);

        self.occupied[index] = false;
        self.occupied_count
            .checked_sub(1)
            .ok_or(ObligationPoolError::MathOverflow)?;

        Ok(())
    }

    pub fn remove_obligation(&mut self, obligation: Pubkey) -> Result<()> {
        for i in 0..Self::MAX_OBLIGATIONS {
            if self.obligations[i] == obligation {
                self.occupied[i] = false;
                self.occupied_count
                    .checked_sub(1)
                    .ok_or(ObligationPoolError::MathOverflow)?;

                return Ok(());
            }
        }

        Err(ObligationPoolError::NotFound.into())
    }

    pub fn is_full(&self) -> bool {
        self.occupied_count == Self::MAX_OBLIGATIONS as u8
    }

    pub fn pda(index: u32) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"pool", &index.to_le_bytes()], &crate::ID)
    }
}

#[error_code]
pub enum ObligationPoolError {
    #[msg("Overflow error")]
    MathOverflow,
    #[msg("Pool is full")]
    PoolFull,
    #[msg("Invalid index")]
    InvalidIndex,
    #[msg("Slot is empty")]
    SlotEmpty,
    #[msg("Obligationa not found")]
    NotFound,
}
