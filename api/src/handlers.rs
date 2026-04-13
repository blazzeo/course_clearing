use crate::{
    auth_service::verify,
    cron_worker::{WorkerCommand, WorkerState},
    models::*,
};
use actix_web::{http::StatusCode, post, web, HttpResponse, Responder};
use chrono::Utc;
use sqlx::PgPool;
use std::{
    collections::{HashMap, HashSet},
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

pub async fn get_obligations_by_wallet(
    db_pool: web::Data<PgPool>,
    wallet: web::Path<String>,
) -> impl Responder {
    let wallet = wallet.into_inner();
    let rows = sqlx::query_as::<_, DbObligationRecord>(
        r#"
        SELECT
            pda,
            from_address,
            to_address,
            original_amount,
            remaining_amount,
            status,
            created_at,
            updated_at,
            closed_at
        FROM obligations
        WHERE from_address = $1 OR to_address = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(wallet)
    .fetch_all(db_pool.get_ref())
    .await;

    match rows {
        Ok(data) => HttpResponse::Ok().json(ApiResponse::success(data)),
        Err(err) => {
            tracing::error!("Failed to fetch obligations from DB: {err:?}");
            HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error("database query failed".into()))
        }
    }
}

pub async fn get_last_clearing_audit(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
) -> impl Responder {
    let result = {
        let s = worker_state.read().await;
        s.last_session_result.clone()
    };
    HttpResponse::Ok().json(ApiResponse::success(result))
}

pub async fn get_last_clearing_audit_for_wallet(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    db_pool: web::Data<PgPool>,
    wallet: web::Path<String>,
) -> impl Responder {
    let wallet = wallet.into_inner();
    let result = {
        let s = worker_state.read().await;
        s.last_session_result.clone()
    };
    let mut obligation_ids: Vec<String> = result
        .data
        .iter()
        .map(|x| x.obligation.clone())
        .collect();
    obligation_ids.extend(result.internal_data.iter().map(|x| x.obligation.clone()));
    if obligation_ids.is_empty() {
        return HttpResponse::Ok().json(ApiResponse::success(result));
    }

    let matching: Vec<String> = match sqlx::query_scalar::<_, String>(
        r#"
        SELECT pda
        FROM obligations
        WHERE pda = ANY($1) AND (from_address = $2 OR to_address = $2)
        "#,
    )
    .bind(&obligation_ids)
    .bind(&wallet)
    .fetch_all(db_pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("Failed to filter audit by wallet: {err:?}");
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error("database query failed".into()));
        }
    };

    let matched: HashSet<String> = matching.into_iter().collect();
    let mut filtered = result.clone();
    filtered.data.retain(|x| matched.contains(&x.obligation));
    filtered
        .internal_data
        .retain(|x| matched.contains(&x.obligation));
    filtered
        .merkle_leaves
        .retain(|x| matched.contains(&x.obligation));

    HttpResponse::Ok().json(ApiResponse::success(filtered))
}

pub async fn list_clearing_sessions(db_pool: web::Data<PgPool>) -> impl Responder {
    match sqlx::query_as::<_, DbClearingSessionRow>(
        r#"
        SELECT session_id, result_id, result_hash, merkle_root, external_count, internal_count, created_at
        FROM clearing_sessions
        ORDER BY session_id DESC
        LIMIT 100
        "#,
    )
    .fetch_all(db_pool.get_ref())
    .await
    {
        Ok(rows) => HttpResponse::Ok().json(ApiResponse::success(rows)),
        Err(err) => {
            tracing::error!("Failed to list clearing sessions: {err:?}");
            HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error("database query failed".into()))
        }
    }
}

pub async fn get_clearing_session_payload(
    db_pool: web::Data<PgPool>,
    session_id: web::Path<i64>,
) -> impl Responder {
    let sid = session_id.into_inner();
    match sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT payload
        FROM clearing_sessions
        WHERE session_id = $1
        "#,
    )
    .bind(sid)
    .fetch_optional(db_pool.get_ref())
    .await
    {
        Ok(Some(payload)) => HttpResponse::Ok().json(ApiResponse::success(payload)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<String>::error("session not found".into())),
        Err(err) => {
            tracing::error!("Failed to fetch session payload: {err:?}");
            HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error("database query failed".into()))
        }
    }
}
