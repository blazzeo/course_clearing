use crate::models::{Position, SystemSetting, UpdateSystemSettingsRequest};
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

pub async fn get_system_settings(pool: &Pool<Postgres>) -> Result<SystemSetting, sqlx::Error> {
    sqlx::query_as::<_, SystemSetting>("SELECT * FROM system_settings WHERE id = 1")
        .fetch_one(pool)
        .await
}

pub async fn update_system_settings(
    pool: &Pool<Postgres>,
    settings: &UpdateSystemSettingsRequest,
) -> Result<SystemSetting, sqlx::Error> {
    // Строим динамический запрос обновления
    let mut query = "UPDATE system_settings SET updated_at = NOW()".to_string();
    let mut params: Vec<String> = vec![];

    if let Some(val) = settings.clearing_fee {
        params.push(format!("clearing_fee = {}", val));
    }
    if let Some(val) = settings.transaction_fee {
        params.push(format!("transaction_fee = {}", val));
    }
    if let Some(val) = settings.deposit_fee {
        params.push(format!("deposit_fee = {}", val));
    }
    if let Some(val) = settings.withdrawal_fee {
        params.push(format!("withdrawal_fee = {}", val));
    }

    if !params.is_empty() {
        query.push_str(", ");
        query.push_str(&params.join(", "));
    }

    query.push_str(" WHERE id = 1 RETURNING *");

    sqlx::query_as::<_, SystemSetting>(&query)
        .fetch_one(pool)
        .await
}

pub async fn get_system_setting_value(
    pool: &Pool<Postgres>,
    key: &str,
) -> Result<Option<f64>, sqlx::Error> {
    let query = format!("SELECT {}::float8 FROM system_settings WHERE id = 1", key);
    let result: Option<f64> = sqlx::query_scalar(&query).fetch_optional(pool).await?;
    Ok(result)
}
