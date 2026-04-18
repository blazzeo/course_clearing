//! HTTP-слой (Actix): маршруты и метрики.

mod handlers;
pub mod models;

use crate::http::models::WebServerContext;
use actix_web::{web, App, HttpServer};
use models::AppMetrics;
use std::{collections::HashMap, sync::Arc};

pub async fn init_web_server(
    context: WebServerContext,
    frontend_origin: String,
    port: u16,
) -> Result<(), std::io::Error> {
    let metrics = Arc::new(AppMetrics::new());
    let used_nonces = Arc::new(tokio::sync::RwLock::new(HashMap::<String, i64>::new()));

    HttpServer::new(move || {
        let cors = actix_cors::Cors::default()
            .allow_any_method()
            .allow_any_header()
            .allowed_origin(&frontend_origin)
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(context.db_pool.clone()))
            .app_data(web::Data::new(context.worker_state.clone()))
            .app_data(web::Data::new(context.admin_pubkey.clone()))
            .app_data(web::Data::new(context.sender.clone()))
            .app_data(web::Data::new(used_nonces.clone()))
            .app_data(web::Data::new(metrics.clone()))
            .route("/health", web::get().to(handlers::health))
            .route("/live", web::get().to(handlers::liveness))
            .route("/ready", web::get().to(handlers::readiness))
            .route("/metrics", web::get().to(handlers::metrics))
            .service(
                web::scope("/api")
                    .route(
                        "/clearing/run",
                        web::post().to(handlers::multi_party_clearing),
                    )
                    .route(
                        "/clearing/last",
                        web::post().to(handlers::get_last_clearing_result),
                    )
                    .route("/obligations", web::get().to(handlers::get_all_obligations))
                    .route(
                        "/obligations/{wallet}",
                        web::get().to(handlers::get_obligations_by_wallet),
                    )
                    .route(
                        "/participants",
                        web::get().to(handlers::get_all_participants),
                    )
                    .route(
                        "/participants/{authority}",
                        web::get().to(handlers::get_participant_by_authority),
                    )
                    .route(
                        "/clearing/audit/last",
                        web::get().to(handlers::get_last_clearing_audit),
                    )
                    .route(
                        "/clearing/audit/last/{wallet}",
                        web::get().to(handlers::get_last_clearing_audit_for_wallet),
                    )
                    .route(
                        "/clearing/sessions",
                        web::get().to(handlers::list_clearing_sessions),
                    )
                    .route(
                        "/clearing/sessions/{session_id}",
                        web::get().to(handlers::get_clearing_session_payload),
                    ),
            )
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
