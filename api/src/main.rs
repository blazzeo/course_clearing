mod admin_service;
mod auth_service;
mod blockchain;
mod db;
pub mod endpoints;
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
                    .route(
                        "/positions",
                        web::get().to(endpoints::positions::get_positions),
                    )
                    .route(
                        "/positions",
                        web::post().to(endpoints::positions::create_position),
                    )
                    .route(
                        "/positions/{id}",
                        web::get().to(endpoints::positions::get_position),
                    )
                    .route(
                        "/positions/{id}",
                        web::put().to(endpoints::positions::update_position),
                    )
                    .route(
                        "/positions/{id}",
                        web::delete().to(endpoints::positions::delete_position),
                    )
                    .route(
                        "/positions/{id}/confirm",
                        web::post().to(endpoints::positions::confirm_position),
                    )
                    .route(
                        "/positions/{id}/clear",
                        web::post().to(endpoints::clearing::execute_clearing),
                    )
                    .route(
                        "/participants",
                        web::get().to(endpoints::users::get_participants),
                    )
                    .route(
                        "/participants",
                        web::post().to(endpoints::users::register_participant),
                    )
                    .route(
                        "/participants/{address}",
                        web::get().to(endpoints::users::get_participant),
                    )
                    .route(
                        "/clearing/run",
                        web::post().to(endpoints::clearing::multi_party_clearing),
                    )
                    .route(
                        "/settlements",
                        web::get().to(handlers::get_user_settlements),
                    )
                    .route(
                        "/settlements/{id}/pay",
                        web::post().to(handlers::pay_settlement),
                    )
                    .route("/admins", web::get().to(endpoints::admin::get_admins))
                    .route("/admins/add", web::post().to(endpoints::admin::add_admin))
                    .route(
                        "/admins/remove",
                        web::post().to(endpoints::admin::remove_admin),
                    )
                    .route(
                        "/admins/check/{address}",
                        web::get().to(endpoints::admin::check_admin_status),
                    )
                    // Новые маршруты для ролей и профилей
                    .route(
                        "/auth/register-guest",
                        web::post().to(endpoints::users::register_guest_handler),
                    )
                    .route("/profile", web::get().to(endpoints::users::get_profile))
                    .route("/profile", web::put().to(endpoints::users::update_profile))
                    .route(
                        "/admin/change-role",
                        web::post().to(endpoints::admin::change_user_role),
                    )
                    .route(
                        "/admin/deactivate",
                        web::post().to(endpoints::admin::deactivate_participant),
                    )
                    .route(
                        "/admin/activate",
                        web::post().to(endpoints::admin::activate_participant),
                    )
                    .route(
                        "/admin/delete/{address}",
                        web::delete().to(endpoints::admin::delete_participant),
                    )
                    .route(
                        "/system/settings",
                        web::get().to(handlers::get_system_settings),
                    )
                    .route(
                        "/system/settings",
                        web::post().to(handlers::update_system_settings),
                    )
                    .route("/audit/log", web::get().to(endpoints::log::get_audit_log))
                    .route(
                        "/audit/balances",
                        web::get().to(endpoints::funds::get_all_balances),
                    )
                    .route(
                        "/admin/initialize-escrow",
                        web::post().to(endpoints::blockchain::initialize_escrow),
                    )
                    .route(
                        "/admin/withdrawals",
                        web::get().to(endpoints::funds::get_all_withdrawals),
                    )
                    // Новые endpoints для работы со смарт-контрактом
                    .route(
                        "/blockchain/withdrawals",
                        web::get().to(endpoints::funds::get_withdrawals),
                    )
                    .route(
                        "/blockchain/withdrawals",
                        web::delete().to(endpoints::funds::delete_withdrawal),
                    )
                    .route(
                        "/blockchain/deposit",
                        web::post().to(endpoints::blockchain::deposit_funds),
                    )
                    .route(
                        "/blockchain/withdraw/request",
                        web::post().to(endpoints::blockchain::request_withdrawal_instruction),
                    )
                    .route(
                        "/blockchain/withdraw/confirm",
                        web::post().to(endpoints::blockchain::confirm_withdrawal),
                    )
                    .route(
                        "/blockchain/withdraw/approve",
                        web::post().to(endpoints::blockchain::approve_withdrawal),
                    )
                    .route(
                        "/blockchain/withdraw/complete",
                        web::post().to(endpoints::blockchain::complete_withdrawal),
                    )
                    .route(
                        "/blockchain/balance",
                        web::get().to(endpoints::blockchain::get_blockchain_balance),
                    ),
            )
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
