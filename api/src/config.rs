//! Загрузка конфигурации из переменных окружения.
use dotenv::dotenv;
use std::env;

pub struct Config {
    pub solana_rpc_url: String,
    pub solana_ws_url: String,
    pub port: u16,
    pub admin_pubkey: String,
    pub database_url: String,
    pub frontend_origin: String,
}

pub fn parse_env() -> Config {
    dotenv().ok();

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
    let frontend_origin = env::var("FRONTEND_ORIGIN").expect("FRONTEND_ORIGIN env missing");

    Config {
        solana_rpc_url,
        solana_ws_url,
        port,
        admin_pubkey,
        database_url,
        frontend_origin,
    }
}
