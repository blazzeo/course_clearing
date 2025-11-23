use sqlx::{PgPool, Pool, Postgres};

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    // Пытаемся подключиться по DATABASE_URL
    PgPool::connect(database_url).await
}

pub async fn run_migrations(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    init_schema(pool).await
}

// Создаем миграции вручную, так как нет папки migrations
pub async fn init_schema(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS participants (
            id BIGSERIAL PRIMARY KEY,
            address VARCHAR(44) UNIQUE NOT NULL,
            balance BIGINT NOT NULL DEFAULT 0,
            margin BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS positions (
            id BIGSERIAL PRIMARY KEY,
            creator_address VARCHAR(44) NOT NULL,
            counterparty_address VARCHAR(44) NOT NULL,
            amount BIGINT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            confirmed_at TIMESTAMP WITH TIME ZONE,
            cleared_at TIMESTAMP WITH TIME ZONE,
            transaction_signature VARCHAR(88)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS clearing_history (
            id BIGSERIAL PRIMARY KEY,
            clearing_id VARCHAR(255),
            participants TEXT[] NOT NULL,
            amounts BIGINT[] NOT NULL,
            net_amounts BIGINT[] NOT NULL,
            status VARCHAR(20) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            executed_at TIMESTAMP WITH TIME ZONE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_positions_creator ON positions(creator_address);
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_positions_counterparty ON positions(counterparty_address);
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
