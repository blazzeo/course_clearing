mod auth_service;
mod blockchain;
mod handlers;
mod ledger_engine;
mod models;

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use dotenv::dotenv;
use std::{env, sync::Arc};

fn parse_env() -> (String, u16, String) {
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
    dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let (solana_rpc_url, port, admin_pubkey) = parse_env();

    let blockchain_client = blockchain::BlockchainClient::new(&solana_rpc_url)
        .expect("Failed to create blockchain client");

    let blockchain_client_data = Arc::new(blockchain_client);

    tracing::info!("🚀 Starting API server on port {}", port);
    tracing::info!("🤖 Solana RPC URL: {}", solana_rpc_url);

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(solana_rpc_url.clone()))
            .app_data(web::Data::new(blockchain_client_data.clone()))
            .app_data(web::Data::new(admin_pubkey.clone()))
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
