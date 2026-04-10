use anchor_lang::AccountDeserialize;
use chrono::Utc;
use clearing_solana::{ClearingState, Obligation, ObligationPool, ObligationStatus};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use std::sync::Arc;
use tokio::{
    sync::{mpsc, RwLock},
    task::JoinHandle,
    time::Duration,
};

// Тип сообщения для воркера
pub enum WorkerCommand {
    RunInstant(tokio::sync::oneshot::Sender<()>), // Канал для подтверждения завершения
    UpdateInterval(u64),
}

#[derive(serde::Serialize, Clone)]
pub struct AllocationResult {
    pub obligation: Pubkey,
    pub amount: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct NettingSessionResult {
    pub data: Vec<AllocationResult>,
    pub timestamp: i64,
}

pub struct WorkerState {
    pub last_session_result: NettingSessionResult,
    pub interval: u64,
    pub session_id: u64,
    pub solana_client: Arc<RpcClient>,
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
            last_session_result: NettingSessionResult {
                data: vec![],
                timestamp: chrono::Utc::now().timestamp(),
            },
            interval: clearing_state.session_interval_time,
            session_id: clearing_state.total_sessions,
            solana_client: Arc::new(client),
        })
    }
}

pub struct CronWorker {
    handle: Option<JoinHandle<()>>,
    receiver: mpsc::Receiver<WorkerCommand>,
    state: Arc<RwLock<WorkerState>>,
}

impl CronWorker {
    pub fn new(state: Arc<RwLock<WorkerState>>, receiver: mpsc::Receiver<WorkerCommand>) -> Self {
        Self {
            handle: None,
            receiver,
            state,
        }
    }

    pub fn start(&mut self) {
        if self.handle.is_some() {
            tracing::warn!("Worker is already running!");
            return;
        }

        let receiver = std::mem::replace(&mut self.receiver, mpsc::channel(1).1);
        let worker = CronWorker {
            handle: None,
            receiver,
            state: self.state.clone(),
        };

        let handle = tokio::spawn(async move {
            worker.run().await;
        });

        self.handle = Some(handle);
    }

    /// Основной цикл с поддержкой мгновенных команд через канал
    async fn run(mut self) {
        let mut ticker = {
            let interval = self.state.read().await.interval;
            tokio::time::interval(Duration::from_secs(interval))
        };

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if let Err(err) = self.perform_clearing().await {
                        tracing::error!("Scheduled clearing session failed: {err:?}");
                    }
                }

                cmd = self.receiver.recv() => {
                    match cmd {
                        Some(WorkerCommand::RunInstant(respond_to)) => {
                            if let Err(err) = self.perform_clearing().await {
                                tracing::error!("Manual clearing session failed: {err:?}");
                            }
                            let _ = respond_to.send(());
                        }

                        Some(WorkerCommand::UpdateInterval(new_interval)) => {
                            let mut s = self.state.write().await;
                            s.interval = new_interval;

                            ticker = tokio::time::interval(Duration::from_secs(new_interval));
                        }

                        None => break,
                    }
                }
            }
        }
    }

    /// Инкапсулированная логика одной сессии (Single Responsibility)
    async fn perform_clearing(&self) -> anyhow::Result<()> {
        let (sid, client) = {
            let s = self.state.read().await;
            (s.session_id, s.solana_client.clone())
        };
        let all_obligations = Self::collect_obligations(client.as_ref()).await;

        tracing::info!("[Clearing session № {} started!]", sid);

        // IMPORTANT:
        // On-chain create_position processes a whole obligation account (full amount),
        // not a partial allocated amount. Returning partial backend allocations causes
        // mismatches and incorrect clearing amounts.
        let mut allocations: Vec<(Pubkey, u64)> = all_obligations
            .iter()
            .map(|(pda, obligation)| (*pda, obligation.amount))
            .collect();
        allocations.sort_by_key(|(_, amount)| *amount);

        // Сохранение результата
        {
            let mut s = self.state.write().await;
            s.last_session_result = NettingSessionResult {
                data: allocations
                    .into_iter()
                    .map(|(pda, amount)| AllocationResult {
                        obligation: pda,
                        amount,
                    })
                    .collect(),
                timestamp: Utc::now().timestamp(),
            };
            s.session_id += 1;
        }

        tracing::info!("[Clearing session № {} finished!]", sid);
        Ok(())
    }

    async fn collect_obligations(client: &RpcClient) -> Vec<(Pubkey, Obligation)> {
        let mut all_obligations: Vec<(Pubkey, Obligation)> = vec![];

        let (first_pool_pda, _bump) = ObligationPool::pda(0);

        let mut next_pool_pda = Some(Pubkey::new_from_array(first_pool_pda.to_bytes()));

        while let Some(current_pool_pda) = next_pool_pda {
            let pool = match get_account::<ObligationPool>(&client, current_pool_pda).await {
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

            // Iterate over obligations to find Confirmed and PartiallyNetted
            for (pda, account_opt) in obligation_pdas.iter().zip(local_accounts.iter()) {
                if let Some(account) = account_opt {
                    let mut raw_data: &[u8] = &account.data;

                    if let Ok(obligation_account) = Obligation::try_deserialize(&mut raw_data) {
                        let status = obligation_account.status;

                        if status == ObligationStatus::Confirmed
                            || status == ObligationStatus::PartiallyNetted
                        {
                            all_obligations.push((*pda, obligation_account));
                        }
                    }
                }
            }

            next_pool_pda = pool
                .next_pool
                .map(|pubkey| Pubkey::new_from_array(pubkey.to_bytes()));
        }

        all_obligations
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
