use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub id: u32,
    pub timestamp: i64,
}
