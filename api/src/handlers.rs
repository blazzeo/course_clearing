use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{auth_service::verify, cron_worker::WorkerState, models::*};
use actix_web::{web, HttpResponse, Responder};

pub async fn multi_party_clearing(
    worker_state: web::Data<Arc<RwLock<WorkerState>>>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
) -> impl Responder {
    if !verify(admin_pubkey.get_ref(), &payload.message, &payload.signature) {
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(
            "Invalid admin signature".into(),
        ));
    }

    let state = worker_state.get_ref().read().await;

    // Возвращаем settlements с дополнительной информацией для финализации в блокчейне
    let response = serde_json::json!({
        "settlements": state.last_session_result.clone(),
        "message": "Clearing calculated. Use settlement records to finalize on blockchain if needed."
    });

    HttpResponse::Ok().json(ApiResponse::success(response))
}

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}
