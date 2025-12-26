use crate::models::{OutstandingFee, Position, SystemSetting, UpdateSystemSettingsRequest};
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

    if let Some(val) = settings.clearing_min_participants {
        params.push(format!("clearing_min_participants = {}", val));
    }
    if let Some(val) = settings.clearing_max_amount {
        params.push(format!("clearing_max_amount = {}", val));
    }
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
    if let Some(val) = settings.daily_transaction_limit {
        params.push(format!("daily_transaction_limit = {}", val));
    }
    if let Some(val) = settings.monthly_volume_limit {
        params.push(format!("monthly_volume_limit = {}", val));
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

pub async fn create_outstanding_fee(
    pool: &Pool<Postgres>,
    participant_address: &str,
    amount: i64,
    reason: &str,
    session_id: Option<i32>,
    settlement_id: Option<i32>,
) -> Result<i32, sqlx::Error> {
    let result = sqlx::query!(
        "INSERT INTO outstanding_fees (participant_address, amount, reason, session_id, settlement_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
        participant_address,
        amount,
        reason,
        session_id,
        settlement_id
    )
    .fetch_one(pool)
    .await?;

    Ok(result.id)
}

pub async fn get_outstanding_fees(
    pool: &Pool<Postgres>,
    participant_address: &str,
) -> Result<Vec<OutstandingFee>, sqlx::Error> {
    sqlx::query_as::<_, OutstandingFee>(
        "SELECT * FROM outstanding_fees
         WHERE participant_address = $1 AND status = 'outstanding'
         ORDER BY created_at DESC",
    )
    .bind(participant_address)
    .fetch_all(pool)
    .await
}

pub async fn get_total_outstanding_debt(
    pool: &Pool<Postgres>,
    participant_address: &str,
) -> Result<i64, sqlx::Error> {
    let result: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(amount), 0)::bigint as total
         FROM outstanding_fees
         WHERE participant_address = $1 AND status = 'outstanding'",
    )
    .bind(participant_address)
    .fetch_one(pool)
    .await?;

    Ok(result.0)
}

pub async fn mark_fees_as_repaid(
    pool: &Pool<Postgres>,
    participant_address: &str,
    amount: i64,
) -> Result<(), sqlx::Error> {
    // Получаем все непогашенные долги, отсортированные по дате создания
    let fees = sqlx::query_as::<_, (i32, i64)>(
        "SELECT id, amount FROM outstanding_fees
         WHERE participant_address = $1 AND status = 'outstanding'
         ORDER BY created_at ASC",
    )
    .bind(participant_address)
    .fetch_all(pool)
    .await?;

    let mut remaining_amount = amount;
    let mut fee_ids_to_update = Vec::new();

    // Проходим по долгам в порядке создания и помечаем как погашенные
    for (fee_id, fee_amount) in fees {
        if remaining_amount >= fee_amount {
            fee_ids_to_update.push(fee_id);
            remaining_amount -= fee_amount;
        } else if remaining_amount > 0 {
            // Частичное погашение (если нужно)
            fee_ids_to_update.push(fee_id);
            break;
        } else {
            break;
        }
    }

    // Обновляем статус долгов
    if !fee_ids_to_update.is_empty() {
        let ids_str = fee_ids_to_update
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");

        sqlx::query(&format!(
            "UPDATE outstanding_fees SET status = 'repaid' WHERE id IN ({})",
            ids_str
        ))
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn get_all_outstanding_fees(
    pool: &Pool<Postgres>,
) -> Result<Vec<OutstandingFee>, sqlx::Error> {
    sqlx::query_as::<_, OutstandingFee>(
        "SELECT * FROM outstanding_fees
         WHERE status = 'outstanding'
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
}
