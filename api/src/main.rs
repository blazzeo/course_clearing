mod auth_service;
mod cron_worker;
mod handlers;
mod indexer;
mod ledger_engine;
mod models;

use actix_web::{web, App, HttpServer};
use cron_worker::{CronWorker, WorkerState};
use solana_client::nonblocking::rpc_client::RpcClient;
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, env, sync::Arc};
use tokio::sync::mpsc;
use tracing_subscriber::{fmt, EnvFilter};

fn parse_env() -> (String, u16, String, String, String) {
    let solana_rpc_url = env::var("SOLANA_RPC_URL").expect("SOLANA_RPC_URL env missing");

    let port = env::var("PORT")
        .expect("PORT env missing")
        .parse::<u16>()
        .expect("PORT must be a valid number");

    let admin_pubkey = env::var("ADMIN_PUBKEY").expect("ADMIN_PUBKEY env missing");
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL env missing");
    let solana_ws_url = env::var("SOLANA_WS_URL").unwrap_or_else(|_| {
        solana_rpc_url
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    });

    (
        solana_rpc_url,
        port,
        admin_pubkey,
        database_url,
        solana_ws_url,
    )
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(env_filter).init();

    let (solana_rpc_url, port, admin_pubkey, database_url, solana_ws_url) = parse_env();

    let rpc_client = RpcClient::new(solana_rpc_url.clone());
    let db_pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Can't connect to postgres");
    sqlx::migrate!("./migrations")
        .run(&db_pool)
        .await
        .expect("Can't run migrations");

    let worker_state = Arc::new(tokio::sync::RwLock::new(
        WorkerState::new(rpc_client)
            .await
            .expect("Can't init worker state"),
    ));

    let (sender, receiver) = mpsc::channel(10);
    let mut cron_worker = CronWorker::new(worker_state.clone(), receiver);
    cron_worker.start();

    let sender = Arc::new(sender);
    let used_nonces = Arc::new(tokio::sync::RwLock::new(HashMap::<String, i64>::new()));
    let metrics = Arc::new(handlers::AppMetrics::new());
    let frontend_origin = env::var("FRONTEND_ORIGIN").ok();
    tokio::spawn(indexer::index_loop(solana_ws_url, db_pool.clone()));

    tracing::info!("🚀 Starting API server on port {}", port);
    tracing::info!("🤖 Solana RPC URL: {}", solana_rpc_url);

    HttpServer::new(move || {
        let cors = actix_cors::Cors::default()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);
        let cors = if let Some(origin) = &frontend_origin {
            cors.allowed_origin(origin)
        } else {
            cors
        };

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(solana_rpc_url.clone()))
            .app_data(web::Data::new(worker_state.clone()))
            .app_data(web::Data::new(admin_pubkey.clone()))
            .app_data(web::Data::new(sender.clone()))
            .app_data(web::Data::new(used_nonces.clone()))
            .app_data(web::Data::new(metrics.clone()))
            .route("/health", web::get().to(handlers::health))
            .route("/live", web::get().to(handlers::liveness))
            .route("/ready", web::get().to(handlers::readiness))
            .route("/metrics", web::get().to(handlers::metrics))
            .service(web::scope("/api").route(
                "/clearing/run",
                web::post().to(handlers::multi_party_clearing),
            ))
            .service(web::scope("/api").route(
                "/clearing/last",
                web::post().to(handlers::get_last_clearing_result),
            ))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
