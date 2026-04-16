use crate::flow_solver::{solve_min_cost_flow, ExternalSettlement, InternalNetting};
use crate::models::RawSettlement;
use anchor_lang::AccountDeserialize;
use chrono::Utc;
use clearing_solana::{ClearingState, Obligation, ObligationPool, ObligationStatus};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Arc,
};
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
    pub allocator_mode: String,
    pub fallback_reason: Option<String>,
    pub flow_total_cost: Option<String>,
    pub flow_objective: Option<String>,
    pub flow_unmet_demand: Option<u64>,
    pub flow_total: Option<u64>,
    pub flow_total_positive_net: Option<u64>,
    pub input_snapshot_hash: String,
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

#[derive(Clone, Copy)]
enum AllocatorMode {
    Direct,
    Transitive,
    FullFallback,
}

impl AllocatorMode {
    fn as_str(self) -> &'static str {
        match self {
            AllocatorMode::Direct => "direct",
            AllocatorMode::Transitive => "transitive",
            AllocatorMode::FullFallback => "full_fallback",
        }
    }
}

#[derive(Clone, Copy)]
struct AllocationContext {
    pda: Pubkey,
    from: Pubkey,
    to: Pubkey,
    timestamp: i64,
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
                external_count: 0,
                internal_count: 0,
                merkle_root: String::new(),
                merkle_leaves: vec![],
                allocator_mode: "init".to_string(),
                fallback_reason: None,
                flow_total_cost: None,
                flow_objective: None,
                flow_unmet_demand: None,
                flow_total: None,
                flow_total_positive_net: None,
                input_snapshot_hash: String::new(),
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

    fn obligation_contexts(obligations: &[(Pubkey, Obligation)]) -> Vec<AllocationContext> {
        obligations
            .iter()
            .map(|(pda, o)| AllocationContext {
                pda: *pda,
                from: Pubkey::new_from_array(o.from.to_bytes()),
                to: Pubkey::new_from_array(o.to.to_bytes()),
                timestamp: o.timestamp,
            })
            .collect()
    }

    fn allocate_settlements_direct(
        settlements: Vec<RawSettlement>,
        contexts: &[AllocationContext],
        remaining_map: &mut HashMap<Pubkey, u64>,
    ) -> (Vec<(Pubkey, u64)>, Vec<RawSettlement>) {
        let mut result = vec![];
        let mut unmatched = vec![];

        for s in settlements {
            let mut remaining = s.amount;
            let mut relevant: Vec<_> = contexts
                .iter()
                .filter(|ctx| ctx.from == s.from_address && ctx.to == s.to_address)
                .copied()
                .collect();
            relevant.sort_by(|a, b| {
                a.timestamp
                    .cmp(&b.timestamp)
                    .then_with(|| a.pda.to_bytes().cmp(&b.pda.to_bytes()))
            });

            for ctx in relevant {
                if remaining == 0 {
                    break;
                }
                let available = *remaining_map.get(&ctx.pda).unwrap_or(&0);
                if available == 0 {
                    continue;
                }
                let used = std::cmp::min(available, remaining);
                result.push((ctx.pda, used));
                remaining_map.insert(ctx.pda, available - used);
                remaining -= used;
            }
            if remaining > 0 {
                unmatched.push(RawSettlement {
                    from_address: s.from_address,
                    to_address: s.to_address,
                    amount: remaining,
                });
            }
        }
        (result, unmatched)
    }

    fn find_transitive_path(
        from: Pubkey,
        to: Pubkey,
        contexts: &[AllocationContext],
        remaining_map: &HashMap<Pubkey, u64>,
    ) -> Option<Vec<Pubkey>> {
        if from == to {
            return Some(vec![]);
        }
        let mut queue = VecDeque::new();
        let mut visited: HashSet<Pubkey> = HashSet::new();
        let mut parent: HashMap<Pubkey, (Pubkey, Pubkey)> = HashMap::new();
        queue.push_back(from);
        visited.insert(from);

        while let Some(node) = queue.pop_front() {
            let mut outgoing: Vec<_> = contexts
                .iter()
                .filter(|ctx| ctx.from == node && *remaining_map.get(&ctx.pda).unwrap_or(&0) > 0)
                .copied()
                .collect();
            outgoing.sort_by(|a, b| {
                a.to.to_bytes()
                    .cmp(&b.to.to_bytes())
                    .then_with(|| a.timestamp.cmp(&b.timestamp))
                    .then_with(|| a.pda.to_bytes().cmp(&b.pda.to_bytes()))
            });

            for edge in outgoing {
                if visited.insert(edge.to) {
                    parent.insert(edge.to, (node, edge.pda));
                    if edge.to == to {
                        let mut rev_edges: Vec<Pubkey> = Vec::new();
                        let mut cur = to;
                        while cur != from {
                            let (prev, pda) = parent.get(&cur).copied()?;
                            rev_edges.push(pda);
                            cur = prev;
                        }
                        rev_edges.reverse();
                        return Some(rev_edges);
                    }
                    queue.push_back(edge.to);
                }
            }
        }
        None
    }

    fn transitive_can_realize_unmatched(
        unmatched: Vec<RawSettlement>,
        contexts: &[AllocationContext],
        remaining_map: &mut HashMap<Pubkey, u64>,
    ) -> (bool, usize) {
        let mut has_unmatched = false;
        let mut paths_found = 0usize;

        for s in unmatched {
            let mut remaining = s.amount;
            while remaining > 0 {
                let Some(path) = Self::find_transitive_path(
                    s.from_address,
                    s.to_address,
                    contexts,
                    remaining_map,
                ) else {
                    has_unmatched = true;
                    break;
                };
                if path.is_empty() {
                    has_unmatched = true;
                    break;
                }
                let bottleneck = path
                    .iter()
                    .map(|pda| *remaining_map.get(pda).unwrap_or(&0))
                    .min()
                    .unwrap_or(0);
                if bottleneck == 0 {
                    has_unmatched = true;
                    break;
                }
                let used = std::cmp::min(remaining, bottleneck);
                for pda in path {
                    let avail = *remaining_map.get(&pda).unwrap_or(&0);
                    if avail < used {
                        has_unmatched = true;
                        break;
                    }
                    remaining_map.insert(pda, avail - used);
                }
                paths_found += 1;
                remaining -= used;
            }
        }
        (!has_unmatched, paths_found)
    }

    fn allocate_settlements_v2(
        settlements: Vec<RawSettlement>,
        obligations: &Vec<(Pubkey, Obligation)>,
        transitive_enabled: bool,
        audit_log: &mut Vec<AuditLogEntry>,
    ) -> (
        Vec<(Pubkey, u64)>,
        Vec<(Pubkey, u64)>,
        AllocatorMode,
        Option<String>,
    ) {
        let contexts = Self::obligation_contexts(obligations);
        let mut remaining_map: HashMap<Pubkey, u64> = obligations
            .iter()
            .map(|(pda, o)| (*pda, o.amount))
            .collect();

        let (direct_allocs, unmatched) =
            Self::allocate_settlements_direct(settlements, &contexts, &mut remaining_map);
        if unmatched.is_empty() {
            let internal = Self::compute_internal_nettings(&direct_allocs, obligations);
            return (direct_allocs, internal, AllocatorMode::Direct, None);
        }
        if !transitive_enabled {
            return (
                Self::full_obligation_allocations(obligations),
                vec![],
                AllocatorMode::FullFallback,
                Some("transitive allocator disabled".to_string()),
            );
        }

        audit_log.push(AuditLogEntry {
            step: "transitive_allocator_started".to_string(),
            detail: format!("unmatched_edges={}", unmatched.len()),
            timestamp: Utc::now().timestamp(),
        });
        let (all_unmatched_covered, paths_found) =
            Self::transitive_can_realize_unmatched(unmatched, &contexts, &mut remaining_map);
        audit_log.push(AuditLogEntry {
            step: "transitive_paths_found".to_string(),
            detail: format!(
                "paths_found={} unmatched_covered={}",
                paths_found, all_unmatched_covered
            ),
            timestamp: Utc::now().timestamp(),
        });

        if !all_unmatched_covered {
            return (
                Self::full_obligation_allocations(obligations),
                vec![],
                AllocatorMode::FullFallback,
                Some(
                    "transitive allocator could not realize all unmatched settlements".to_string(),
                ),
            );
        }

        // Ключевое правило: в transitive-режиме прямые матчи остаются external,
        // а все транзитивно достижимые хвосты уходят в internal (apply_internal_netting),
        // чтобы не плодить счета для оплаты.
        let internal = Self::compute_internal_nettings(&direct_allocs, obligations);
        (direct_allocs, internal, AllocatorMode::Transitive, None)
    }

    fn full_obligation_allocations(obligations: &Vec<(Pubkey, Obligation)>) -> Vec<(Pubkey, u64)> {
        obligations
            .iter()
            .map(|(pda, o)| (*pda, o.amount))
            .collect()
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
                format!("{}->{} amount={} status={}", from, to, o.amount, status)
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

        let allocator_mode = AllocatorMode::Transitive;
        let fallback_reason = None;
        let flow_cost = Some(sol.total_cost.to_string());
        let flow_objective = Some(sol.objective.to_string());
        let unmet_demand = Some(sol.unmet_demand);
        let flow_total = Some(sol.total_flow);
        let flow_total_positive_net = Some(sol.total_positive_net);
        audit_log.push(AuditLogEntry {
            step: "solver_completed".to_string(),
            detail: format!(
                "allocator_mode={} external_allocations={} internal_nettings={}",
                allocator_mode.as_str(),
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
            allocator_mode: allocator_mode.as_str().to_string(),
            fallback_reason,
            flow_total_cost: flow_cost,
            flow_objective,
            flow_unmet_demand: unmet_demand,
            flow_total,
            flow_total_positive_net,
            input_snapshot_hash,
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
        }

        tracing::info!("[Clearing session № {} finished!]", sid);
        Ok(())
    }

    fn hash_input_snapshot(input_obligations: &[InputObligationSnapshot]) -> String {
        let mut hasher = Sha256::new();
        for item in input_obligations {
            hasher.update(item.obligation.as_bytes());
            hasher.update(item.from.as_bytes());
            hasher.update(item.to.as_bytes());
            hasher.update(item.amount.to_le_bytes());
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
            return (String::new(), vec![]);
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

    fn mk_ob(from: Pubkey, to: Pubkey, amount: u64, timestamp: i64) -> Obligation {
        Obligation {
            status: ObligationStatus::Confirmed,
            from: anchor_lang::prelude::Pubkey::new_from_array(from.to_bytes()),
            to: anchor_lang::prelude::Pubkey::new_from_array(to.to_bytes()),
            amount,
            timestamp,
            session_id: None,
            from_cancel: false,
            to_cancel: false,
            pool_id: 0,
            bump: 0,
        }
    }

    #[test]
    fn allocate_v2_falls_back_when_transitive_disabled() {
        let u1 = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let u2 = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let u3 = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").expect("pk");

        let settlements = vec![RawSettlement {
            from_address: u1,
            to_address: u2,
            amount: 5,
        }];

        let mut obligations = Vec::new();
        obligations.push((Pubkey::new_unique(), mk_ob(u1, u3, 5, 1)));
        obligations.push((Pubkey::new_unique(), mk_ob(u3, u2, 5, 2)));

        let mut audit = vec![];
        let (alloc, internal, mode, reason) =
            CronWorker::allocate_settlements_v2(settlements, &obligations, false, &mut audit);
        assert!(matches!(mode, AllocatorMode::FullFallback));
        assert_eq!(internal.len(), 0);
        assert_eq!(alloc.len(), 2);
        assert!(reason.is_some());
    }

    #[test]
    fn allocate_v2_uses_transitive_paths_deterministically() {
        let u1 = Pubkey::from_str("11111111111111111111111111111111").expect("pk");
        let u2 = Pubkey::from_str("So11111111111111111111111111111111111111112").expect("pk");
        let u3 = Pubkey::from_str("Sysvar1111111111111111111111111111111111111").expect("pk");

        let settlements = vec![RawSettlement {
            from_address: u1,
            to_address: u2,
            amount: 5,
        }];

        let p1 = Pubkey::new_unique();
        let p2 = Pubkey::new_unique();
        let obligations = vec![(p1, mk_ob(u1, u3, 5, 1)), (p2, mk_ob(u3, u2, 5, 2))];

        let mut audit1 = vec![];
        let (alloc1, internal1, mode1, reason1) = CronWorker::allocate_settlements_v2(
            settlements.clone(),
            &obligations,
            true,
            &mut audit1,
        );
        let mut audit2 = vec![];
        let (alloc2, internal2, mode2, reason2) =
            CronWorker::allocate_settlements_v2(settlements, &obligations, true, &mut audit2);

        assert!(matches!(mode1, AllocatorMode::Transitive));
        assert!(matches!(mode2, AllocatorMode::Transitive));
        assert_eq!(reason1, None);
        assert_eq!(reason2, None);
        assert_eq!(alloc1, alloc2);
        assert_eq!(internal1, internal2);
        assert!(alloc1.is_empty());
        assert_eq!(internal1, vec![(p1, 5), (p2, 5)]);
    }
}
