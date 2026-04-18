mod auth;
mod config;
mod http;
mod indexer;
mod solver;
mod worker;

use crate::http::{init_web_server, models::WebServerContext};
use solana_client::nonblocking::rpc_client::RpcClient;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing_subscriber::{fmt, EnvFilter};
use worker::{Worker, WorkerState};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = config::parse_env();

    let db_pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .expect("Can't connect to postgres");
    sqlx::migrate!("./migrations")
        .run(&db_pool)
        .await
        .expect("Can't run migrations");

    let rpc_client = Arc::new(RpcClient::new(config.solana_rpc_url.clone()));

    let worker_state = Arc::new(RwLock::new(
        WorkerState::new(rpc_client.clone(), db_pool.clone())
            .await
            .expect("Can't init worker state"),
    ));
    let (sender, receiver) = mpsc::channel(10);
    Worker::new(worker_state.clone(), receiver).start();

    let sender = Arc::new(sender);

    tokio::spawn(indexer::index_loop(
        config.solana_ws_url,
        rpc_client,
        db_pool.clone(),
        sender.clone(),
    ));

    let context = WebServerContext {
        worker_state,
        db_pool,
        sender,
        admin_pubkey: config.admin_pubkey,
    };

    tracing::info!("Starting API server on port {}", config.port);
    tracing::info!("Solana RPC URL: {}", config.solana_rpc_url);

    init_web_server(context, config.frontend_origin, config.port).await
}
