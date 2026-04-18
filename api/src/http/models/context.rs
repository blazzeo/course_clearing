//! Состояние, разделяемое между воркером и HTTP (пул БД, канал команд, метрики).

use crate::worker::{WorkerCommand, WorkerState};
use sqlx::{Pool, Postgres};
use std::sync::{atomic::AtomicU64, Arc};
use tokio::sync::{mpsc::Sender, RwLock};

pub struct WebServerContext {
    pub db_pool: Pool<Postgres>,
    pub worker_state: Arc<RwLock<WorkerState>>,
    pub admin_pubkey: String,
    pub sender: Arc<Sender<WorkerCommand>>,
}

pub struct AppMetrics {
    pub clearing_requests_total: AtomicU64,
    pub admin_auth_failures_total: AtomicU64,
}

impl AppMetrics {
    pub fn new() -> Self {
        Self {
            clearing_requests_total: AtomicU64::new(0),
            admin_auth_failures_total: AtomicU64::new(0),
        }
    }
}
