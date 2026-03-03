use anchor_lang::prelude::*;

#[error_code]
pub enum CustomErrors {
    #[msg("Math overflow error")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Forbidden")]
    Forbidden,
}
