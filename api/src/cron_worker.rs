use crate::ledger_engine::netting_clearing;
use crate::models::RawSettlement;
use anchor_lang::AccountDeserialize;
use chrono::Utc;
use clearing_solana::{ClearingState, Obligation, ObligationPool, ObligationStatus};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;

use std::{collections::HashMap, sync::Arc};
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
    pub obligation: String,
    pub amount: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct InternalNettingResult {
    pub obligation: String,
    pub amount: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct NettingSessionResult {
    pub session_id: u64,
    pub result_id: String,
    pub hash: String,
    pub solver_version: String,
    pub build_sha: String,
    pub input_obligations: Vec<InputObligationSnapshot>,
    pub data: Vec<AllocationResult>,
    pub internal_data: Vec<InternalNettingResult>,
    pub merkle_root: String,
    pub merkle_leaves: Vec<MerkleLeafProof>,
    pub audit_log: Vec<AuditLogEntry>,
    pub timestamp: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct InputObligationSnapshot {
    pub obligation: String,
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub status: String,
    pub timestamp: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct MerkleLeafProof {
    pub kind: String,
    pub obligation: String,
    pub amount: u64,
    pub leaf_hash: String,
    pub proof: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct AuditLogEntry {
    pub step: String,
    pub detail: String,
    pub timestamp: i64,
}

pub struct WorkerState {
    pub last_session_result: NettingSessionResult,
    pub interval: u64,
    pub session_id: u64,
    pub solana_client: Arc<RpcClient>,
    pub db_pool: PgPool,
}

impl WorkerState {
    pub async fn new(client: RpcClient, db_pool: PgPool) -> anyhow::Result<Self> {
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
                session_id: clearing_state.total_sessions,
                result_id: "init".to_string(),
                hash: String::new(),
                solver_version: env!("CARGO_PKG_VERSION").to_string(),
                build_sha: std::env::var("BUILD_SHA").unwrap_or_else(|_| "dev".to_string()),
                input_obligations: vec![],
                data: vec![],
                internal_data: vec![],
                merkle_root: String::new(),
                merkle_leaves: vec![],
                audit_log: vec![],
                timestamp: chrono::Utc::now().timestamp(),
            },
            interval: clearing_state.session_interval_time,
            session_id: clearing_state.total_sessions,
            solana_client: Arc::new(client),
            db_pool,
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

    fn parse_obligations(obligations: &Vec<(Pubkey, Obligation)>) -> (Vec<Pubkey>, Vec<i64>) {
        let mut net: HashMap<Pubkey, i128> = HashMap::new();
        for (_pda, obligation) in obligations {
            *net.entry(Pubkey::new_from_array(obligation.from.to_bytes()))
                .or_insert(0) -= obligation.amount as i128;
            *net.entry(Pubkey::new_from_array(obligation.to.to_bytes()))
                .or_insert(0) += obligation.amount as i128;
        }

        let mut participants = Vec::new();
        let mut amounts = Vec::new();
        for (addr, amt) in net {
            if amt != 0 {
                participants.push(addr);
                amounts.push(amt as i64);
            }
        }
        (participants, amounts)
    }

    fn allocate_settlements(
        settlements: Vec<RawSettlement>,
        obligations: &Vec<(Pubkey, Obligation)>,
    ) -> (Vec<(Pubkey, u64)>, bool) {
        let mut result = vec![];
        let mut remaining_map: HashMap<Pubkey, u64> =
            obligations.iter().map(|(pda, o)| (*pda, o.amount)).collect();
        let mut has_unmatched_settlement = false;

        for s in settlements {
            let mut remaining = s.amount;
            let mut relevant: Vec<_> = obligations
                .iter()
                .filter(|(_, o)| {
                    Pubkey::new_from_array(o.from.to_bytes()) == s.from_address
                        && Pubkey::new_from_array(o.to.to_bytes()) == s.to_address
                })
                .collect();
            relevant.sort_by_key(|(_, o)| o.timestamp);

            for (pda, _) in relevant {
                if remaining == 0 {
                    break;
                }
                let available = *remaining_map.get(pda).unwrap_or(&0);
                if available == 0 {
                    continue;
                }
                let used = std::cmp::min(available, remaining);
                result.push((*pda, used));
                remaining_map.insert(*pda, available - used);
                remaining -= used;
            }
            if remaining > 0 {
                has_unmatched_settlement = true;
            }
        }
        (result, has_unmatched_settlement)
    }

    fn full_obligation_allocations(obligations: &Vec<(Pubkey, Obligation)>) -> Vec<(Pubkey, u64)> {
        obligations.iter().map(|(pda, o)| (*pda, o.amount)).collect()
    }

    fn canonical_sort_allocations(items: &mut Vec<(Pubkey, u64)>) {
        items.sort_by(|a, b| {
            a.0.to_bytes()
                .cmp(&b.0.to_bytes())
                .then_with(|| a.1.cmp(&b.1))
        });
    }

    fn build_input_snapshot(obligations: &[(Pubkey, Obligation)]) -> Vec<InputObligationSnapshot> {
        let status_to_string = |status: ObligationStatus| match status {
            ObligationStatus::Created => "created",
            ObligationStatus::Confirmed => "confirmed",
            ObligationStatus::PartiallyNetted => "partially_netted",
            ObligationStatus::Declined => "declined",
            ObligationStatus::Netted => "netted",
            ObligationStatus::Cancelled => "cancelled",
        };
        let mut snapshot: Vec<InputObligationSnapshot> = obligations
            .iter()
            .map(|(pda, o)| InputObligationSnapshot {
                obligation: pda.to_string(),
                from: Pubkey::new_from_array(o.from.to_bytes()).to_string(),
                to: Pubkey::new_from_array(o.to.to_bytes()).to_string(),
                amount: o.amount,
                status: status_to_string(o.status).to_string(),
                timestamp: o.timestamp,
            })
            .collect();
        snapshot.sort_by(|a, b| {
            a.obligation
                .cmp(&b.obligation)
                .then_with(|| a.timestamp.cmp(&b.timestamp))
        });
        snapshot
    }

    /// Инкапсулированная логика одной сессии (Single Responsibility)
    async fn perform_clearing(&self) -> anyhow::Result<()> {
        let (sid, client, db_pool) = {
            let s = self.state.read().await;
            (s.session_id, s.solana_client.clone(), s.db_pool.clone())
        };
        let all_obligations = Self::collect_obligations(client.as_ref()).await;

        tracing::info!("[Clearing session № {} started!]", sid);
        let mut audit_log = vec![AuditLogEntry {
            step: "session_started".to_string(),
            detail: format!("session={} obligations={}", sid + 1, all_obligations.len()),
            timestamp: Utc::now().timestamp(),
        }];

        let (participants, amounts) = Self::parse_obligations(&all_obligations);
        tracing::info!(
            "Worker observed on-chain obligations for session {}: count={}",
            sid,
            all_obligations.len()
        );
        let settlements = netting_clearing(&participants, &amounts)
            .map_err(|e| anyhow::anyhow!("Netting error: {}", e))?;
        let (candidate_allocations, has_unmatched_settlement) =
            Self::allocate_settlements(settlements, &all_obligations);
        let (mut allocations, mut internal_data) = if has_unmatched_settlement {
            audit_log.push(AuditLogEntry {
                step: "fallback_applied".to_string(),
                detail: "non-realizable settlement edges detected; switched to fully realizable per-obligation plan".to_string(),
                timestamp: Utc::now().timestamp(),
            });
            (Self::full_obligation_allocations(&all_obligations), vec![])
        } else {
            let internal = Self::compute_internal_nettings(&candidate_allocations, &all_obligations);
            (candidate_allocations, internal)
        };
        Self::canonical_sort_allocations(&mut allocations);
        Self::canonical_sort_allocations(&mut internal_data);
        audit_log.push(AuditLogEntry {
            step: "solver_completed".to_string(),
            detail: format!(
                "external_allocations={} internal_nettings={}",
                allocations.len(),
                internal_data.len()
            ),
            timestamp: Utc::now().timestamp(),
        });
        tracing::info!(
            "Worker netting result session {}: payment_allocations={}, internal_nettings={}",
            sid,
            allocations.len(),
            internal_data.len()
        );
        let next_session_id = sid + 1;
        let input_obligations = Self::build_input_snapshot(&all_obligations);
        let hash = Self::hash_allocations(next_session_id, &allocations, &internal_data);
        let (merkle_root, merkle_leaves) = Self::build_merkle_tree(&allocations, &internal_data);
        audit_log.push(AuditLogEntry {
            step: "merkle_built".to_string(),
            detail: format!(
                "merkle_root={} leaves={}",
                merkle_root,
                merkle_leaves.len()
            ),
            timestamp: Utc::now().timestamp(),
        });
        let timestamp = Utc::now().timestamp();

        // Сохранение результата
        let session_result = NettingSessionResult {
            session_id: next_session_id,
            result_id: format!("session-{next_session_id}-{timestamp}"),
            hash,
            solver_version: env!("CARGO_PKG_VERSION").to_string(),
            build_sha: std::env::var("BUILD_SHA").unwrap_or_else(|_| "dev".to_string()),
            input_obligations,
            data: allocations
                .into_iter()
                .map(|(pda, amount)| AllocationResult {
                    obligation: pda.to_string(),
                    amount,
                })
                .collect(),
            internal_data: internal_data
                .into_iter()
                .map(|(pda, amount)| InternalNettingResult {
                    obligation: pda.to_string(),
                    amount,
                })
                .collect(),
            merkle_root,
            merkle_leaves,
            audit_log,
            timestamp,
        };

        sqlx::query(
            r#"
            INSERT INTO clearing_sessions (
                session_id, result_id, result_hash, merkle_root,
                external_count, internal_count, payload, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (session_id) DO UPDATE SET
                result_id = EXCLUDED.result_id,
                result_hash = EXCLUDED.result_hash,
                merkle_root = EXCLUDED.merkle_root,
                external_count = EXCLUDED.external_count,
                internal_count = EXCLUDED.internal_count,
                payload = EXCLUDED.payload,
                created_at = EXCLUDED.created_at
            "#,
        )
        .bind(i64::try_from(session_result.session_id).unwrap_or(i64::MAX))
        .bind(&session_result.result_id)
        .bind(&session_result.hash)
        .bind(&session_result.merkle_root)
        .bind(i32::try_from(session_result.data.len()).unwrap_or(i32::MAX))
        .bind(i32::try_from(session_result.internal_data.len()).unwrap_or(i32::MAX))
        .bind(serde_json::to_value(&session_result)?)
        .bind(session_result.timestamp)
        .execute(&db_pool)
        .await?;

        {
            let mut s = self.state.write().await;
            s.last_session_result = session_result;
            s.session_id = next_session_id;
        }

        tracing::info!("[Clearing session № {} finished!]", sid);
        Ok(())
    }

    fn hash_allocations(
        session_id: u64,
        allocations: &[(Pubkey, u64)],
        internal_data: &[(Pubkey, u64)],
    ) -> String {
        let mut hasher = Sha256::new();
        hasher.update(session_id.to_le_bytes());
        for (pda, amount) in allocations {
            hasher.update(pda.to_bytes());
            hasher.update(amount.to_le_bytes());
        }
        hasher.update([0xff]);
        for (pda, amount) in internal_data {
            hasher.update(pda.to_bytes());
            hasher.update(amount.to_le_bytes());
        }
        format!("{:x}", hasher.finalize())
    }

    fn compute_internal_nettings(
        allocations: &[(Pubkey, u64)],
        obligations: &Vec<(Pubkey, Obligation)>,
    ) -> Vec<(Pubkey, u64)> {
        let mut allocated_by_obligation: HashMap<Pubkey, u64> = HashMap::new();
        for (pda, amount) in allocations {
            *allocated_by_obligation.entry(*pda).or_insert(0) += *amount;
        }
        obligations
            .iter()
            .filter_map(|(pda, obligation)| {
                let allocated = allocated_by_obligation.get(pda).copied().unwrap_or(0);
                if obligation.amount > allocated {
                    Some((*pda, obligation.amount - allocated))
                } else {
                    None
                }
            })
            .collect()
    }

    fn leaf_hash(kind: &str, pda: &Pubkey, amount: u64) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(kind.as_bytes());
        hasher.update(pda.to_bytes());
        hasher.update(amount.to_le_bytes());
        hasher.finalize().into()
    }

    fn parent_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(left);
        hasher.update(right);
        hasher.finalize().into()
    }

    fn to_hex(hash: [u8; 32]) -> String {
        hash.iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn build_merkle_tree(
        allocations: &[(Pubkey, u64)],
        internal_data: &[(Pubkey, u64)],
    ) -> (String, Vec<MerkleLeafProof>) {
        let mut leaves_meta: Vec<(String, Pubkey, u64, [u8; 32])> = Vec::new();
        for (pda, amount) in allocations {
            leaves_meta.push((
                "external".to_string(),
                *pda,
                *amount,
                Self::leaf_hash("external", pda, *amount),
            ));
        }
        for (pda, amount) in internal_data {
            leaves_meta.push((
                "internal".to_string(),
                *pda,
                *amount,
                Self::leaf_hash("internal", pda, *amount),
            ));
        }
        if leaves_meta.is_empty() {
            return (String::new(), vec![]);
        }

        let mut levels: Vec<Vec<[u8; 32]>> = vec![leaves_meta.iter().map(|x| x.3).collect()];
        while levels.last().map(|l| l.len()).unwrap_or(0) > 1 {
            let prev = levels.last().cloned().unwrap_or_default();
            let mut next = Vec::new();
            let mut i = 0usize;
            while i < prev.len() {
                let left = prev[i];
                let right = if i + 1 < prev.len() { prev[i + 1] } else { prev[i] };
                next.push(Self::parent_hash(left, right));
                i += 2;
            }
            levels.push(next);
        }
        let root = levels
            .last()
            .and_then(|l| l.first())
            .copied()
            .map(Self::to_hex)
            .unwrap_or_default();

        let mut proofs = Vec::new();
        for (idx, (kind, obligation, amount, leaf)) in leaves_meta.iter().enumerate() {
            let mut proof = Vec::new();
            let mut index = idx;
            for level in &levels[..levels.len() - 1] {
                let sibling = if index % 2 == 0 {
                    if index + 1 < level.len() {
                        level[index + 1]
                    } else {
                        level[index]
                    }
                } else {
                    level[index - 1]
                };
                proof.push(Self::to_hex(sibling));
                index /= 2;
            }
            proofs.push(MerkleLeafProof {
                kind: kind.clone(),
                obligation: obligation.to_string(),
                amount: *amount,
                leaf_hash: Self::to_hex(*leaf),
                proof,
            });
        }

        (root, proofs)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn allocate_settlements_detects_unmatched_multilateral_edge() {
        let u1 = Pubkey::from_str("11111111111111111111111111111111").unwrap();
        let u2 = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let u3 = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").unwrap();

        let settlements = vec![
            RawSettlement { from_address: u1, to_address: u2, amount: 4 },
            RawSettlement { from_address: u1, to_address: u3, amount: 3 },
        ];

        let mut obligations = Vec::new();
        let mk_ob = |from: Pubkey, to: Pubkey, amount: u64| Obligation {
            status: ObligationStatus::Confirmed,
            from: anchor_lang::prelude::Pubkey::new_from_array(from.to_bytes()),
            to: anchor_lang::prelude::Pubkey::new_from_array(to.to_bytes()),
            amount,
            timestamp: 0,
            session_id: None,
            from_cancel: false,
            to_cancel: false,
            pool_id: 0,
            bump: 0,
        };
        obligations.push((Pubkey::new_unique(), mk_ob(u1, u2, 6)));
        obligations.push((Pubkey::new_unique(), mk_ob(u1, u3, 1)));
        obligations.push((Pubkey::new_unique(), mk_ob(u2, u3, 2)));

        let (_alloc, has_unmatched) = CronWorker::allocate_settlements(settlements, &obligations);
        assert!(has_unmatched);
    }
}
