use crate::{
    auth_service::verify,
    cron_worker::{WorkerCommand, WorkerState},
    models::*,
};
use actix_web::{http::StatusCode, post, web, HttpResponse, Responder};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

pub async fn multi_party_clearing(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
) -> impl Responder {
    if !verify(admin_pubkey.get_ref(), &payload.message, &payload.signature) {
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(
            "Invalid admin signature".into(),
        ));
    }

    let state = worker_state.get_ref().read().await;
    let res = &state.last_session_result;

    HttpResponse::Ok().json(ApiResponse::success(res))
}

pub async fn instant_clearing_session(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
    sender: web::Data<mpsc::Sender<WorkerCommand>>,
) -> impl Responder {
    if !verify(admin_pubkey.get_ref(), &payload.message, &payload.signature) {
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(
            "Invalid admin signature".into(),
        ));
    }

    let (tx_done, rx_done) = oneshot::channel();

    if let Err(e) = sender.send(WorkerCommand::RunInstant(tx_done)).await {
        tracing::error!("Failed to send command to worker: {e}");
        return HttpResponse::ServiceUnavailable().into();
    }

    match rx_done.await {
        Ok(_) => {
            let result = {
                let s = worker_state.read().await;
                s.last_session_result.clone()
            };
            HttpResponse::Ok().json(result)
        }
        Err(_) => HttpResponse::InternalServerError().into(),
    }
}

#[post("/{new_interval_time}")]
pub async fn update_intervaltime(
    worker_state: web::Data<Arc<tokio::sync::RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
    new_interval_time: web::Path<u64>,
    sender: web::Data<mpsc::Sender<WorkerCommand>>,
) -> impl Responder {
    if !verify(admin_pubkey.get_ref(), &payload.message, &payload.signature) {
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(
            "Invalid admin signature".into(),
        ));
    }

    {
        worker_state.write().await.interval = *new_interval_time;
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
