mod admin_service;
mod auth_service;
mod blockchain;
mod db;
mod handlers;
mod ledger_engine;
mod models;

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use dotenv::dotenv;
use std::{env, sync::Arc};

fn parse_env() -> (String, u16, String, String) {
    let solana_rpc_url = env::var("SOLANA_RPC_URL").expect("SOLANA_RPC_URL env missing");

    let port = env::var("PORT")
        .expect("PORT env missing")
        .parse::<u16>()
        .expect("PORT must be a valid number");

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL env missing");

    let admin_pubkey = env::var("ADMIN_PUBKEY").expect("ADMIN_PUBKEY env missing");

    (solana_rpc_url, port, database_url, admin_pubkey)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let (solana_rpc_url, port, database_url, admin_pubkey) = parse_env();

    let pool = db::create_pool(&database_url)
        .await
        .expect("Failed to create database pool");

    let blockchain_client = blockchain::BlockchainClient::new(&solana_rpc_url)
        .expect("Failed to create blockchain client");

    let blockchain_client_data = Arc::new(blockchain_client);

    db::run_migrations(&pool)
        .await
        .expect("Failed to initialize database schema");

    db::create_main_admin(&pool, admin_pubkey)
        .await
        .expect("Can't create admin user");

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
            .app_data(web::Data::new(pool.clone()))
            .app_data(web::Data::new(solana_rpc_url.clone()))
            .app_data(web::Data::new(blockchain_client_data.clone()))
            .route("/health", web::get().to(handlers::health))
            .route("/system/info", web::get().to(handlers::get_system_info))
            .service(
                web::scope("/api")
                    .route("/positions", web::get().to(handlers::get_positions))
                    .route("/positions", web::post().to(handlers::create_position))
                    .route("/positions/{id}", web::get().to(handlers::get_position))
                    .route("/positions/{id}", web::put().to(handlers::update_position))
                    .route(
                        "/positions/{id}",
                        web::delete().to(handlers::delete_position),
                    )
                    .route(
                        "/positions/{id}/confirm",
                        web::post().to(handlers::confirm_position),
                    )
                    .route(
                        "/positions/{id}/clear",
                        web::post().to(handlers::execute_clearing),
                    )
                    .route("/participants", web::get().to(handlers::get_participants))
                    .route(
                        "/participants",
                        web::post().to(handlers::register_participant),
                    )
                    .route(
                        "/participants/{address}",
                        web::get().to(handlers::get_participant),
                    )
                    .route(
                        "/clearing/run",
                        web::post().to(handlers::multi_party_clearing),
                    )
                    .route(
                        "/settlements",
                        web::get().to(handlers::get_user_settlements),
                    )
                    .route(
                        "/settlements/{id}/pay",
                        web::post().to(handlers::pay_settlement),
                    )
                    .route("/admins", web::get().to(handlers::get_admins))
                    .route("/admins/add", web::post().to(handlers::add_admin))
                    .route("/admins/remove", web::post().to(handlers::remove_admin))
                    .route(
                        "/admins/check/{address}",
                        web::get().to(handlers::check_admin_status),
                    )
                    // Новые маршруты для ролей и профилей
                    .route(
                        "/auth/register-guest",
                        web::post().to(handlers::register_guest_handler),
                    )
                    .route("/profile", web::get().to(handlers::get_profile))
                    .route("/profile", web::put().to(handlers::update_profile))
                    .route(
                        "/admin/change-role",
                        web::post().to(handlers::change_user_role),
                    )
                    .route(
                        "/admin/deactivate",
                        web::post().to(handlers::deactivate_participant),
                    )
                    .route(
                        "/admin/activate",
                        web::post().to(handlers::activate_participant),
                    )
                    .route(
                        "/admin/delete/{address}",
                        web::delete().to(handlers::delete_participant),
                    )
                    .route(
                        "/system/settings",
                        web::get().to(handlers::get_system_settings),
                    )
                    .route(
                        "/system/settings",
                        web::post().to(handlers::update_system_settings),
                    )
                    .route("/audit/log", web::get().to(handlers::get_audit_log))
                    .route("/audit/balances", web::get().to(handlers::get_all_balances))
                    .route(
                        "/admin/deploy-contract",
                        web::post().to(handlers::deploy_clearing_contract),
                    )
                    // Новые endpoints для работы со смарт-контрактом
                    .route(
                        "/blockchain/deposit",
                        web::post().to(handlers::deposit_funds),
                    )
                    .route(
                        "/blockchain/withdraw/request",
                        web::post().to(handlers::request_withdrawal),
                    )
                    .route(
                        "/blockchain/withdraw/approve",
                        web::post().to(handlers::approve_withdrawal),
                    )
                    .route(
                        "/blockchain/balance",
                        web::get().to(handlers::get_blockchain_balance),
                    ),
            )
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
