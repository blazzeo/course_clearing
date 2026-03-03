use anchor_lang::prelude::*;

pub mod custom_accounts;
pub mod errors;
pub mod events;
pub mod instructions;

declare_id!("DtFHUe9366drd6czf5hocSrWswr2DRT9YQhrbfQRmt15");

#[program]
pub mod clearing_solana {
    use super::*;
}
