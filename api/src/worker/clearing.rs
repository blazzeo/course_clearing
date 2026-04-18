//! Реализация воркера клиринга (очередь, Solana, БД, решатель).

use crate::solver::{solve_min_cost_flow, ExternalSettlement, InternalNetting};
use anchor_lang::AccountDeserialize;
use chrono::Utc;
use clearing_solana::{ClearingState, Obligation, ObligationPool, ObligationStatus};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;

use std::sync::Arc;
use tokio::{
    sync::{mpsc, RwLock},
    task::JoinHandle,
};

// Тип сообщения для воркера
pub enum WorkerCommand {
    RunInstant(tokio::sync::oneshot::Sender<()>), // Канал для подтверждения завершения
    IntervalUpdated(u64),
    OperationalDayClosed(i64),
}

#[derive(serde::Serialize, Clone)]
pub struct AllocationResult {
    pub from: String,
    pub to: String,
    pub amount: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct InternalNettingResult {
    pub obligation: String,
    pub amount: u64,
    pub flow_used: u64,
    pub edge_used_in_flow: bool,
    pub edge_used_in_cycle: bool,
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
    pub external_count: u32,
    pub internal_count: u32,
    pub merkle_root: String,
    pub merkle_leaves: Vec<MerkleLeafProof>,
    pub fallback_reason: Option<String>,
    pub flow_total_cost: Option<String>,
    pub flow_objective: Option<String>,
    pub flow_unmet_demand: Option<u64>,
    pub flow_total: Option<u64>,
    pub flow_total_positive_net: Option<u64>,
    pub input_snapshot_hash: String,
    pub audit_log: Vec<AuditLogEntry>,
    pub timestamp: i64,
    /// День расчёта (граница операционного дня), совпадает с `settlement_operational_day` on-chain.
    pub settlement_operational_day: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct InputObligationSnapshot {
    pub obligation: String,
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub expecting_operational_day: u64,
    pub status: String,
    pub timestamp: i64,
}

#[derive(serde::Serialize, Clone)]
pub struct MerkleLeafProof {
    pub kind: String,
    pub index: u32,
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
    pub session_interval_time: u64,
    pub session_id: u64,
    pub last_clearing_operational_day: i64,
    pub solana_client: Arc<RpcClient>,
    pub db_pool: PgPool,
}

impl WorkerState {
    pub async fn new(client: Arc<RpcClient>, db_pool: PgPool) -> anyhow::Result<Self> {
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
                external_count: 0,
                internal_count: 0,
                merkle_root: String::new(),
                merkle_leaves: vec![],
                fallback_reason: None,
                flow_total_cost: None,
                flow_objective: None,
                flow_unmet_demand: None,
                flow_total: None,
                flow_total_positive_net: None,
                input_snapshot_hash: String::new(),
                audit_log: vec![],
                timestamp: chrono::Utc::now().timestamp(),
                settlement_operational_day: 0,
            },
            session_interval_time: clearing_state.session_interval_time,
            session_id: clearing_state.total_sessions,
            last_clearing_operational_day: clearing_state.last_clearing_operational_day,
            solana_client: client,
            db_pool,
        })
    }
}

pub struct Worker {
    handle: Option<JoinHandle<()>>,
    receiver: mpsc::Receiver<WorkerCommand>,
    state: Arc<RwLock<WorkerState>>,
}

impl Worker {
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
        let worker = Worker {
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
        loop {
            let cmd = self.receiver.recv().await;
            match cmd {
                Some(WorkerCommand::RunInstant(respond_to)) => {
                    tracing::info!("Worker command received: RunInstant");
                    if let Err(err) = self.perform_clearing_manual().await {
                        tracing::error!("Manual clearing session failed: {err:?}");
                    }
                    let _ = respond_to.send(());
                }
                Some(WorkerCommand::OperationalDayClosed(closed_day)) => {
                    tracing::info!(
                        "Worker command received: OperationalDayClosed(new_operational_day={})",
                        closed_day
                    );
                    if let Err(err) = self
                        .perform_clearing_for_day(
                            closed_day,
                            true,
                            "indexer_operational_day_advanced",
                        )
                        .await
                    {
                        tracing::error!("Operational day clearing failed: {err:?}");
                    }
                }
                Some(WorkerCommand::IntervalUpdated(new_interval)) => {
                    tracing::info!(
                        "Worker command received: IntervalUpdated(new_interval={}s)",
                        new_interval
                    );
                    let mut s = self.state.write().await;
                    s.session_interval_time = new_interval;
                    tracing::info!("Worker session interval updated to {}s", new_interval);
                }
                None => break,
            }
        }
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
                expecting_operational_day: o.expecting_operational_day,
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
    async fn perform_clearing_manual(&self) -> anyhow::Result<()> {
        let client = {
            let s = self.state.read().await;
            s.solana_client.clone()
        };
        let (pda, _bump) = clearing_solana::ClearingState::pda();
        let state: ClearingState =
            get_account(client.as_ref(), Pubkey::new_from_array(pda.to_bytes())).await?;
        self.perform_clearing_for_day(state.operational_day, false, "manual_run_instant")
            .await
    }

    async fn perform_clearing_for_day(
        &self,
        operational_day: i64,
        enforce_schedule: bool,
        source: &'static str,
    ) -> anyhow::Result<()> {
        let (sid, client, db_pool) = {
            let s = self.state.read().await;
            (s.session_id, s.solana_client.clone(), s.db_pool.clone())
        };
        let closed_operational_day = operational_day.saturating_sub(86_400);
        let (is_clearing_day, interval, last_day) = {
            let s = self.state.read().await;
            (
                s.last_clearing_operational_day
                    .saturating_add(i64::try_from(s.session_interval_time).unwrap_or(i64::MAX))
                    == closed_operational_day,
                s.session_interval_time,
                s.last_clearing_operational_day,
            )
        };
        tracing::debug!(
            "Worker clearing check: source={} sid={} operational_day={} closed_operational_day={} enforce_schedule={} last_clearing_operational_day={} interval={}s",
            source,
            sid,
            operational_day,
            closed_operational_day,
            enforce_schedule,
            last_day,
            interval
        );
        if enforce_schedule && !is_clearing_day {
            tracing::info!(
                "Skip clearing for closed operational day {} (last={}, interval={}s source={})",
                closed_operational_day,
                last_day,
                interval,
                source
            );
            return Ok(());
        }

        let target_operational_day = closed_operational_day;
        let all_obligations =
            Self::collect_obligations(client.as_ref(), target_operational_day).await;

        if all_obligations.is_empty() {
            tracing::debug!(
                "No eligible obligations for target_operational_day={} source={}; creating deterministic empty session",
                target_operational_day,
                source
            );
        }

        tracing::info!(
            "[Clearing session № {} started!] source={} operational_day={} closed_operational_day={}",
            sid,
            source,
            operational_day,
            closed_operational_day
        );
        let mut audit_log = vec![AuditLogEntry {
            step: "session_started".to_string(),
            detail: format!("session={} obligations={}", sid + 1, all_obligations.len()),
            timestamp: Utc::now().timestamp(),
        }];

        let mut input_edges: Vec<String> = all_obligations
            .iter()
            .map(|(_, o)| {
                let from = Pubkey::new_from_array(o.from.to_bytes());
                let to = Pubkey::new_from_array(o.to.to_bytes());
                let status = match o.status {
                    ObligationStatus::Created => "created",
                    ObligationStatus::Confirmed => "confirmed",
                    ObligationStatus::PartiallyNetted => "partially_netted",
                    ObligationStatus::Declined => "declined",
                    ObligationStatus::Netted => "netted",
                    ObligationStatus::Cancelled => "cancelled",
                };
                format!(
                    "{}->{} amount={} status={} expecting_day={}",
                    from, to, o.amount, status, o.expecting_operational_day
                )
            })
            .collect();
        input_edges.sort();
        audit_log.push(AuditLogEntry {
            step: "input_obligations_snapshot".to_string(),
            detail: format!("edges=[{}]", input_edges.join("; ")),
            timestamp: Utc::now().timestamp(),
        });
        tracing::info!(
            "Worker observed on-chain obligations for session {}: count={}",
            sid,
            all_obligations.len()
        );
        audit_log.push(AuditLogEntry {
            step: "flow_graph_built".to_string(),
            detail: format!("obligation_edges={}", all_obligations.len()),
            timestamp: Utc::now().timestamp(),
        });

        let Some(sol) = solve_min_cost_flow(&all_obligations) else {
            return Err(anyhow::anyhow!("mcmf could not produce a solution"));
        };

        audit_log.push(AuditLogEntry {
            step: "mcmf_solved".to_string(),
            detail: format!(
                "objective={} total_cost={} total_flow={} positive_net={} unmet_demand={}",
                sol.objective,
                sol.total_cost,
                sol.total_flow,
                sol.total_positive_net,
                sol.unmet_demand
            ),
            timestamp: Utc::now().timestamp(),
        });
        if sol.total_flow != sol.total_positive_net {
            audit_log.push(AuditLogEntry {
                step: "unmet_demand_detected".to_string(),
                detail: format!(
                    "total_flow={} total_positive_net={} unmet_demand={}",
                    sol.total_flow, sol.total_positive_net, sol.unmet_demand
                ),
                timestamp: Utc::now().timestamp(),
            });
        }

        let mut allocations = sol.external_settlements;
        allocations.sort_by(|a, b| {
            a.from
                .to_bytes()
                .cmp(&b.from.to_bytes())
                .then_with(|| a.to.to_bytes().cmp(&b.to.to_bytes()))
                .then_with(|| a.amount.cmp(&b.amount))
        });

        let mut internal_data = sol.internal_nettings;
        internal_data.sort_by(|a, b| {
            a.obligation
                .to_bytes()
                .cmp(&b.obligation.to_bytes())
                .then_with(|| a.amount.cmp(&b.amount))
        });

        let fallback_reason = None;
        let flow_cost = Some(sol.total_cost.to_string());
        let flow_objective = Some(sol.objective.to_string());
        let unmet_demand = Some(sol.unmet_demand);
        let flow_total = Some(sol.total_flow);
        let flow_total_positive_net = Some(sol.total_positive_net);
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
        let input_snapshot_hash = Self::hash_input_snapshot(&input_obligations);
        let solver_version = env!("CARGO_PKG_VERSION").to_string();
        let hash = Self::hash_allocations(
            next_session_id,
            &solver_version,
            &input_snapshot_hash,
            &allocations,
            &internal_data,
        );
        let (merkle_root, merkle_leaves) = Self::build_merkle_tree(&allocations, &internal_data);
        let external_count = allocations.len() as u32;
        let internal_count = internal_data
            .iter()
            .filter(|item| item.flow_used > 0)
            .count() as u32;
        audit_log.push(AuditLogEntry {
            step: "merkle_built".to_string(),
            detail: format!("merkle_root={} leaves={}", merkle_root, merkle_leaves.len()),
            timestamp: Utc::now().timestamp(),
        });
        let timestamp = Utc::now().timestamp();

        // Сохранение результата
        let session_result = NettingSessionResult {
            session_id: next_session_id,
            result_id: format!("session-{next_session_id}-{timestamp}"),
            hash,
            solver_version: solver_version.clone(),
            build_sha: std::env::var("BUILD_SHA").unwrap_or_else(|_| "dev".to_string()),
            input_obligations,
            data: allocations
                .into_iter()
                .map(|s| AllocationResult {
                    from: s.from.to_string(),
                    to: s.to.to_string(),
                    amount: s.amount,
                })
                .collect(),
            external_count,
            internal_data: internal_data
                .into_iter()
                .map(|item| InternalNettingResult {
                    obligation: item.obligation.to_string(),
                    amount: item.amount,
                    flow_used: item.flow_used,
                    edge_used_in_flow: item.edge_used_in_flow,
                    edge_used_in_cycle: item.edge_used_in_cycle,
                })
                .collect(),
            internal_count,
            merkle_root,
            merkle_leaves,
            fallback_reason,
            flow_total_cost: flow_cost,
            flow_objective,
            flow_unmet_demand: unmet_demand,
            flow_total,
            flow_total_positive_net,
            input_snapshot_hash,
            audit_log,
            timestamp,
            settlement_operational_day: target_operational_day,
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
        .bind(i32::try_from(session_result.external_count).unwrap_or(i32::MAX))
        .bind(i32::try_from(session_result.internal_count).unwrap_or(i32::MAX))
        .bind(serde_json::to_value(&session_result)?)
        .bind(session_result.timestamp)
        .execute(&db_pool)
        .await?;

        {
            let mut s = self.state.write().await;
            s.last_session_result = session_result;
            s.session_id = next_session_id;
            s.last_clearing_operational_day = closed_operational_day;
        }

        tracing::info!(
            "[Clearing session № {} finished!] source={} closed_operational_day={}",
            sid,
            source,
            closed_operational_day
        );
        Ok(())
    }

    fn hash_input_snapshot(input_obligations: &[InputObligationSnapshot]) -> String {
        let mut hasher = Sha256::new();
        for item in input_obligations {
            hasher.update(item.obligation.as_bytes());
            hasher.update(item.from.as_bytes());
            hasher.update(item.to.as_bytes());
            hasher.update(item.amount.to_le_bytes());
            hasher.update(item.expecting_operational_day.to_le_bytes());
            hasher.update(item.status.as_bytes());
            hasher.update(item.timestamp.to_le_bytes());
        }
        format!("{:x}", hasher.finalize())
    }

    fn hash_allocations(
        session_id: u64,
        solver_version: &str,
        input_snapshot_hash: &str,
        allocations: &[ExternalSettlement],
        internal_data: &[InternalNetting],
    ) -> String {
        let mut hasher = Sha256::new();
        hasher.update(session_id.to_le_bytes());
        hasher.update(solver_version.as_bytes());
        hasher.update(input_snapshot_hash.as_bytes());
        for item in allocations {
            hasher.update(item.from.to_bytes());
            hasher.update(item.to.to_bytes());
            hasher.update(item.amount.to_le_bytes());
        }
        hasher.update([0xff]);
        for item in internal_data {
            hasher.update(item.obligation.to_bytes());
            hasher.update(item.amount.to_le_bytes());
            hasher.update(item.flow_used.to_le_bytes());
            hasher.update([u8::from(item.edge_used_in_flow)]);
            hasher.update([u8::from(item.edge_used_in_cycle)]);
        }
        format!("{:x}", hasher.finalize())
    }

    fn leaf_hash(kind: &str, key: &[u8], amount: u64) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(kind.as_bytes());
        hasher.update(key);
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
        allocations: &[ExternalSettlement],
        internal_data: &[InternalNetting],
    ) -> (String, Vec<MerkleLeafProof>) {
        let mut leaves_meta: Vec<(String, String, u64, [u8; 32])> = Vec::new();
        for item in allocations {
            let item_key = format!("{}->{}", item.from, item.to);
            let mut key_bytes = Vec::with_capacity(64);
            key_bytes.extend_from_slice(&item.from.to_bytes());
            key_bytes.extend_from_slice(&item.to.to_bytes());
            leaves_meta.push((
                "external".to_string(),
                item_key,
                item.amount,
                Self::leaf_hash("external", &key_bytes, item.amount),
            ));
        }
        for item in internal_data {
            if item.flow_used == 0 {
                continue;
            }
            leaves_meta.push((
                "internal".to_string(),
                item.obligation.to_string(),
                item.flow_used,
                Self::leaf_hash("internal", &item.obligation.to_bytes(), item.flow_used),
            ));
        }
        if leaves_meta.is_empty() {
            // Deterministic non-zero root for an empty session plan.
            return (
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
                vec![],
            );
        }

        let mut levels: Vec<Vec<[u8; 32]>> = vec![leaves_meta.iter().map(|x| x.3).collect()];
        while levels.last().map(|l| l.len()).unwrap_or(0) > 1 {
            let prev = levels.last().cloned().unwrap_or_default();
            let mut next = Vec::new();
            let mut i = 0usize;
            while i < prev.len() {
                let left = prev[i];
                let right = if i + 1 < prev.len() {
                    prev[i + 1]
                } else {
                    prev[i]
                };
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
        for (idx, (kind, entry, amount, leaf)) in leaves_meta.iter().enumerate() {
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
                index: idx as u32,
                obligation: entry.clone(),
                amount: *amount,
                leaf_hash: Self::to_hex(*leaf),
                proof,
            });
        }

        (root, proofs)
    }

    async fn collect_obligations(
        client: &RpcClient,
        target_operational_day: i64,
    ) -> Vec<(Pubkey, Obligation)> {
        let mut all_obligations: Vec<(Pubkey, Obligation)> = vec![];

        let (first_pool_pda, _bump) = ObligationPool::pda(0);

        let mut next_pool_pda = Some(Pubkey::new_from_array(first_pool_pda.to_bytes()));

        while let Some(current_pool_pda) = next_pool_pda {
            let pool = match get_account::<ObligationPool>(client, current_pool_pda).await {
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

                        if (status == ObligationStatus::Confirmed
                            || status == ObligationStatus::PartiallyNetted)
                            && i64::try_from(obligation_account.expecting_operational_day)
                                .unwrap_or(i64::MAX)
                                <= target_operational_day
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
