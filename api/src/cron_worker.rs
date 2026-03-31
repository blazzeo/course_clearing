use crate::ledger_engine::netting_clearing;
use crate::models::RawSettlement;

use anchor_lang::AccountDeserialize;
use clearing_solana::{Obligation, ObligationPool, ObligationStatus};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::{
    task::JoinHandle,
    time::{sleep, Duration},
};

pub struct WorkerState {
    pub data: Vec<RawSettlement>,
    pub interval: i64,
    pub session_id: i64,
    pub solana_client: Arc<RpcClient>,
}

pub struct CronWorker {
    handle: Option<JoinHandle<()>>,
}

impl CronWorker {
    pub fn start(state: Arc<RwLock<WorkerState>>) -> Self {
        let handle = tokio::spawn(async move {
            loop {
                let interval = {
                    let s = state.read().await;
                    s.interval
                };

                sleep(Duration::from_secs(interval as u64)).await;

                let mut obligations: Vec<Obligation> = vec![];

                {
                    let s = state.read().await;
                    let client = &s.solana_client;

                    let pool = get_account::<ObligationPool>(
                        client,
                        SearchVariant::Seeds(&[b"pool", &(0u32).to_le_bytes()]),
                    )
                    .await
                    .expect("Can't find account");

                    // Get obligations from pools
                    while pool.next_pool.is_some() {
                        for obligaion_pda in pool.obligations {
                            let pda = Pubkey::new_from_array(obligaion_pda.to_bytes());
                            let obligaion =
                                get_account::<Obligation>(client, SearchVariant::Pda(pda))
                                    .await
                                    .expect("Can't find");

                            if obligaion.status == ObligationStatus::Confirmed {
                                obligations.push(obligaion);
                            }
                        }
                    }

                    // Run netting algo
                    // let result = netting_clearing(participants, amounts);

                    // Construct response

                    // Send response to handler

                    // Update metadata
                    let mut s = state.write().await;
                    s.session_id += 1;
                }
            }
        });

        Self {
            handle: Some(handle),
        }
    }

    pub fn restart(&mut self, state: Arc<RwLock<WorkerState>>) {
        if let Some(handle) = self.handle.take() {
            handle.abort(); // stop immediatly
        }

        *self = Self::start(state);
    }
}

enum SearchVariant<'a> {
    Pda(Pubkey),
    Seeds(&'a [&'a [u8]]),
}

//  Helper function
pub async fn get_account<T: AccountDeserialize>(
    client: &RpcClient,
    search_variant: SearchVariant<'_>,
) -> Result<T, &'static str> {
    let account_pda = match search_variant {
        SearchVariant::Pda(pda) => pda,
        SearchVariant::Seeds(seeds) => {
            let program_id = Pubkey::new_from_array(clearing_solana::ID.to_bytes());
            let (pool_pda, _bump) = Pubkey::find_program_address(seeds, &program_id);
            pool_pda
        }
    };

    // Get latest clearing positions
    let raw_account = client
        .get_account(&account_pda)
        .await
        .map_err(|_| "Account not found")?;

    let mut raw_data: &[u8] = &raw_account.data;

    let account = T::try_deserialize(&mut raw_data).map_err(|_| "Deserialize error")?;

    Ok(account)
}
