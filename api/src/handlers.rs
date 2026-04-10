use crate::{
    auth_service::verify,
    cron_worker::{WorkerCommand, WorkerState},
    models::*,
};
use actix_web::{http::StatusCode, post, web, HttpResponse, Responder};
use chrono::Utc;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::sync::{mpsc, oneshot};

const ADMIN_REQUEST_TTL_SECONDS: i64 = 300;

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

async fn verify_admin_request(
    admin_pubkey: &str,
    payload: &AdminSignedRequest,
    used_nonces: &tokio::sync::RwLock<HashMap<String, i64>>,
) -> Result<(), &'static str> {
    if !verify(admin_pubkey, &payload.message, &payload.signature) {
        return Err("Invalid admin signature");
    }

    let nonce = payload.nonce.as_deref().ok_or("Missing nonce")?;
    let timestamp = payload.timestamp.ok_or("Missing timestamp")?;
    let now = Utc::now().timestamp();

    if (now - timestamp).abs() > ADMIN_REQUEST_TTL_SECONDS {
        return Err("Request expired");
    }

    let mut store = used_nonces.write().await;
    store.retain(|_, ts| now - *ts <= ADMIN_REQUEST_TTL_SECONDS);
    if store.contains_key(nonce) {
        return Err("Replay request detected");
    }
    store.insert(nonce.to_owned(), now);
    Ok(())
}

pub async fn multi_party_clearing(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
    sender: web::Data<Arc<mpsc::Sender<WorkerCommand>>>,
    used_nonces: web::Data<Arc<tokio::sync::RwLock<HashMap<String, i64>>>>,
    metrics: web::Data<Arc<AppMetrics>>,
) -> impl Responder {
    if let Err(err) =
        verify_admin_request(admin_pubkey.get_ref(), &payload, used_nonces.as_ref()).await
    {
        metrics
            .admin_auth_failures_total
            .fetch_add(1, Ordering::Relaxed);
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(err.to_string()));
    }
    metrics
        .clearing_requests_total
        .fetch_add(1, Ordering::Relaxed);

    let (tx_done, rx_done) = oneshot::channel();
    if let Err(e) = sender.send(WorkerCommand::RunInstant(tx_done)).await {
        tracing::error!("Failed to send command to worker: {e}");
        return HttpResponse::ServiceUnavailable()
            .json(ApiResponse::<String>::error("Worker unavailable".into()));
    }

    match rx_done.await {
        Ok(_) => {
            let result = {
                let state = worker_state.get_ref().read().await;
                state.last_session_result.clone()
            };
            HttpResponse::Ok().json(ApiResponse::success(result))
        }
        Err(_) => HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
            "Worker response channel closed".into(),
        )),
    }
}

pub async fn get_last_clearing_result(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
    used_nonces: web::Data<Arc<tokio::sync::RwLock<HashMap<String, i64>>>>,
    metrics: web::Data<Arc<AppMetrics>>,
) -> impl Responder {
    if let Err(err) =
        verify_admin_request(admin_pubkey.get_ref(), &payload, used_nonces.as_ref()).await
    {
        metrics
            .admin_auth_failures_total
            .fetch_add(1, Ordering::Relaxed);
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(err.to_string()));
    }
    metrics
        .clearing_requests_total
        .fetch_add(1, Ordering::Relaxed);
    let result = {
        let s = worker_state.read().await;
        s.last_session_result.clone()
    };
    HttpResponse::Ok().json(ApiResponse::success(result))
}

#[post("/{new_interval_time}")]
pub async fn update_intervaltime(
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
    new_interval_time: web::Path<u64>,
    sender: web::Data<mpsc::Sender<WorkerCommand>>,
    used_nonces: web::Data<Arc<tokio::sync::RwLock<HashMap<String, i64>>>>,
    metrics: web::Data<Arc<AppMetrics>>,
) -> impl Responder {
    if let Err(err) =
        verify_admin_request(admin_pubkey.get_ref(), &payload, used_nonces.as_ref()).await
    {
        metrics
            .admin_auth_failures_total
            .fetch_add(1, Ordering::Relaxed);
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(err.to_string()));
    }

    if let Err(e) = sender
        .send(WorkerCommand::UpdateInterval(
            new_interval_time.into_inner(),
        ))
        .await
    {
        tracing::error!("Couldn't update interval time: {e}");
        return HttpResponse::new(StatusCode::SERVICE_UNAVAILABLE);
    }

    HttpResponse::Ok().finish()
}

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}

pub async fn liveness() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("alive"))
}

pub async fn readiness(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
) -> impl Responder {
    let client = {
        let state = worker_state.read().await;
        state.solana_client.clone()
    };

    match client.get_health().await {
        Ok(_) => HttpResponse::Ok().json(ApiResponse::success("ready")),
        Err(err) => {
            tracing::error!("Readiness failed: {err:?}");
            HttpResponse::ServiceUnavailable().json(ApiResponse::<String>::error(
                "solana rpc unavailable".into(),
            ))
        }
    }
}

pub async fn metrics(metrics: web::Data<Arc<AppMetrics>>) -> impl Responder {
    let body = format!(
        "clearing_requests_total {}\nadmin_auth_failures_total {}\n",
        metrics.clearing_requests_total.load(Ordering::Relaxed),
        metrics.admin_auth_failures_total.load(Ordering::Relaxed)
    );
    HttpResponse::Ok()
        .content_type("text/plain; version=0.0.4")
        .body(body)
}
