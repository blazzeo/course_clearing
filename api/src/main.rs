mod auth_service;
mod cron_worker;
mod handlers;
mod ledger_engine;
mod models;

use actix_web::{web, App, HttpServer};
use cron_worker::{CronWorker, WorkerState};
use solana_client::nonblocking::rpc_client::RpcClient;
use std::sync::Arc;

fn parse_env() -> (String, u16, String) {
    use std::env;

    let solana_rpc_url = env::var("SOLANA_RPC_URL").expect("SOLANA_RPC_URL env missing");

    let port = env::var("PORT")
        .expect("PORT env missing")
        .parse::<u16>()
        .expect("PORT must be a valid number");

    let admin_pubkey = env::var("ADMIN_PUBKEY").expect("ADMIN_PUBKEY env missing");

    (solana_rpc_url, port, admin_pubkey)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let (solana_rpc_url, port, admin_pubkey) = parse_env();

    let rpc_client = RpcClient::new(solana_rpc_url.clone());

    let worker_state = Arc::new(tokio::sync::RwLock::new(
        WorkerState::new(rpc_client)
            .await
            .expect("Can't init worker state"),
    ));
    let cron_worker = Arc::new(CronWorker::start(worker_state.clone()));

    tracing::info!("🚀 Starting API server on port {}", port);
    tracing::info!("🤖 Solana RPC URL: {}", solana_rpc_url);

    HttpServer::new(move || {
        let cors = actix_cors::Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(solana_rpc_url.clone()))
            .app_data(web::Data::new(worker_state.clone()))
            .app_data(web::Data::new(admin_pubkey.clone()))
            .app_data(web::Data::new(cron_worker.clone()))
            .route("/health", web::get().to(handlers::health))
            .service(web::scope("/api").route(
                "/clearing/run",
                web::post().to(handlers::multi_party_clearing),
            ))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
