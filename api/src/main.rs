mod db;
mod handlers;
mod models;

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use dotenv::dotenv;
use std::env;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let solana_rpc_url =
        env::var("SOLANA_RPC_URL").unwrap_or_else(|_| "http://localhost:8899".to_string());
    println!("SOLANA_RPC_URL = {:?}", &solana_rpc_url);

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid number");
    println!("PORT = {:?}", &port);

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    println!("DATABASE_URL = {:?}", &database_url);

    let pool = db::create_pool(&database_url)
        .await
        .expect("Failed to create database pool");

    db::run_migrations(&pool)
        .await
        .expect("Failed to initialize database schema");

    tracing::info!("Starting API server on port {}", port);
    tracing::info!("Solana RPC URL: {}", solana_rpc_url);

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
            .route("/health", web::get().to(handlers::health))
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
                        "/participants/{address}",
                        web::get().to(handlers::get_participant),
                    )
                    .route(
                        "/participants/{address}/balance",
                        web::get().to(handlers::get_balance),
                    )
                    .route(
                        "/clearing/multi-party",
                        web::post().to(handlers::multi_party_clearing),
                    )
                    .route("/margin/deposit", web::post().to(handlers::deposit_margin))
                    .route(
                        "/margin/withdraw",
                        web::post().to(handlers::withdraw_margin),
                    ),
            )
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
