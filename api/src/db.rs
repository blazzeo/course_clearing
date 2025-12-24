use crate::models::{Position, SystemSetting};
use sqlx::{
    migrate::{MigrateError, Migrator},
    PgPool, Pool, Postgres,
};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPool::connect(database_url).await
}

pub async fn run_migrations(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    match MIGRATOR.run(pool).await {
        Ok(()) => {
            println!("Migrations successfully applied.");
            Ok(())
        }
        Err(MigrateError::VersionMismatch(version)) => {
            println!("Migration version mismatch: {version:?}, but continuing.");
            Ok(())
        }
        Err(MigrateError::Dirty(_)) => {
            eprintln!("Database is in a dirty migration state.");
            Err(MigrateError::Dirty(-1).into())
        }
        Err(e) => {
            eprintln!("Migration error: {e}");
            Err(e.into())
        }
    }
}

pub async fn create_main_admin(
    pool: &Pool<Postgres>,
    admin_pubkey: String,
) -> Result<(), sqlx::Error> {
    // Проверяем, есть ли уже такой пользователь
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM participants WHERE address = $1)")
            .bind(&admin_pubkey)
            .fetch_one(pool)
            .await?;

    if exists {
        return Ok(()); // Просто выходим, не добавляя
    }

    // Добавляем, если нет
    sqlx::query("INSERT INTO participants (address, user_type) VALUES ($1, 'administrator')")
        .bind(admin_pubkey)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn collect_confirmed_positions(
    pool: &Pool<Postgres>,
) -> Result<Vec<Position>, sqlx::Error> {
    let res: Vec<Position> = sqlx::query_as(
        r#"
        SELECT * FROM positions
        WHERE status = 'confirmed'
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(res)
}

pub async fn update_system_settings(
    pool: &Pool<Postgres>,
    key: &str,
    value: &str,
    desc: &Option<String>,
) -> Result<SystemSetting, sqlx::Error> {
    sqlx::query_as::<_, SystemSetting>(
        r#"
        INSERT INTO system_settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            description = EXCLUDED.description,
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(key)
    .bind(value)
    .bind(desc)
    .fetch_one(pool)
    .await
}

pub async fn get_system_settings(pool: &Pool<Postgres>) -> Result<Vec<SystemSetting>, sqlx::Error> {
    sqlx::query_as::<_, SystemSetting>("SELECT * FROM system_settings ORDER BY key")
        .fetch_all(pool)
        .await
}
