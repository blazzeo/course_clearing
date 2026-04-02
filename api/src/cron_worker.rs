use crate::ledger_engine::netting_clearing;
use crate::models::RawSettlement;

use anchor_lang::AccountDeserialize;
use clearing_solana::{ClearingState, Obligation, ObligationPool, ObligationStatus};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use std::{collections::HashMap, sync::Arc};
use tokio::{
    sync::RwLock,
    task::JoinHandle,
    time::{sleep, Duration},
};

pub struct WorkerState {
    pub last_session_result: Vec<RawSettlement>,
    pub interval: u64,
    pub session_id: u64,
    pub solana_client: RpcClient,
}

impl WorkerState {
    pub async fn new(client: RpcClient) -> anyhow::Result<Self> {
        let (pda, _bump) = clearing_solana::ClearingState::pda();

        let clearing_state: ClearingState =
            match get_account(&client, Pubkey::new_from_array(pda.to_bytes())).await {
                Ok(res) => res,
                Err(err) => {
                    tracing::error!("{:?}", err);
                    return Err(err);
                }
            };

        Ok(Self {
            last_session_result: vec![],
            interval: clearing_state.session_interval_time,
            session_id: clearing_state.total_sessions,
            solana_client: client,
        })
    }
}

pub struct CronWorker {
    handle: Option<JoinHandle<()>>,
}

impl CronWorker {
    pub fn start(state: Arc<RwLock<WorkerState>>) -> Self {
        let handle = tokio::spawn(async move {
            tracing::info!("Cron Worker is up!");

            loop {
                {
                    let s = state.read().await;
                    let interval = s.interval;
                    let sid = s.session_id;
                    sleep(Duration::from_secs(interval)).await;
                    tracing::info!("[Clearing session № {sid} started!]");
                }

                let mut all_obligations: Vec<(Pubkey, Obligation)> = vec![];

                let (first_pool_pda, _bump) = ObligationPool::pda(0);

                let mut next_pool_pda = Some(Pubkey::new_from_array(first_pool_pda.to_bytes()));

                let client = { &state.read().await.solana_client };

                while let Some(current_pool_pda) = next_pool_pda {
                    let pool = match get_account::<ObligationPool>(&client, current_pool_pda).await
                    {
                        Ok(o) => o,
                        Err(e) => {
                            tracing::error!("Pool load error: {:?}", e);
                            break;
                        }
                    };

                    //  Collect all non default obligation PDAs
                    let obligation_pdas: Vec<Pubkey> = pool
                        .obligations
                        .iter()
                        .map(|pda_arr| Pubkey::new_from_array(pda_arr.to_bytes()))
                        .filter(|pda| pda != &Pubkey::default())
                        .collect();

                    let mut local_accounts = Vec::new();
                    for chunk in obligation_pdas.chunks(100) {
                        if let Ok(res) = client.get_multiple_accounts(chunk).await {
                            local_accounts.extend(res);
                        }
                    }

                    // Iterate over obligations to find Confirmed
                    for (pda, account_opt) in obligation_pdas.iter().zip(local_accounts.iter()) {
                        if let Some(account) = account_opt {
                            let mut raw_data: &[u8] = &account.data;
                            if let Ok(obligation_account) =
                                Obligation::try_deserialize(&mut raw_data)
                            {
                                if obligation_account.status == ObligationStatus::Confirmed {
                                    all_obligations.push((*pda, obligation_account));
                                }
                            }
                        }
                    }

                    next_pool_pda = pool
                        .next_pool
                        .map(|pubkey| Pubkey::new_from_array(pubkey.to_bytes()));
                }

                // Run netting algo
                // 2. Считаем net-сальдо
                let mut net: HashMap<Pubkey, i128> = HashMap::new();
                for (_pda, obligation) in &all_obligations {
                    *net.entry(Pubkey::new_from_array(obligation.from.to_bytes()))
                        .or_insert(0) -= obligation.amount as i128;
                    *net.entry(Pubkey::new_from_array(obligation.to.to_bytes()))
                        .or_insert(0) += obligation.amount as i128;
                }

                // Фильтр 0
                let mut participants = Vec::new();
                let mut amounts = Vec::new();
                for (addr, amt) in net {
                    if amt != 0 {
                        participants.push(addr);
                        amounts.push(amt as i64);
                    }
                }

                let resp = match netting_clearing(&participants, &amounts) {
                    Ok(res) => res,
                    Err(e) => {
                        tracing::error!("{e}");
                        vec![]
                    }
                };

                // Save result + Update metadata
                {
                    let mut s = state.write().await;
                    s.last_session_result = resp;
                    s.session_id += 1;
                }

                tracing::info!("[Clearing session is over!]");
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

        tracing::info!("Cron worker restared");
    }
}

//  Helper function
pub async fn get_account<T: AccountDeserialize>(
    client: &RpcClient,
    pda: Pubkey,
) -> anyhow::Result<T> {
    let raw_account = client.get_account(&pda).await?;

    let mut raw_data: &[u8] = &raw_account.data;

    let account = T::try_deserialize(&mut raw_data)?;

    Ok(account)
}
