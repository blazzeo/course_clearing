use crate::auth_service::require_auth;
use crate::models::{ApiResponse, AuditLog};
use actix_web::{web, HttpResponse, Responder};
use sqlx::PgPool;

/// Функция для логирования действий пользователей для аудита
pub async fn log_audit_action(
    pool: &PgPool,
    user_address: &str,
    action: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    old_values: Option<serde_json::Value>,
    new_values: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO audit_log (user_address, action, resource_type, resource_id, old_values, new_values) VALUES ($1, $2, $3, $4, $5, $6)",
        user_address,
        action,
        resource_type,
        resource_id,
        old_values,
        new_values
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Получение лога аудита (только аудитор и администратор)
pub async fn get_audit_log(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let auditor_address = match query.get("auditor_address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "auditor_address parameter required".to_string(),
            ))
        }
    };

    // Проверяем права аудитора
    if let Err(resp) = require_auth(pool.get_ref(), auditor_address, "view_audit_log").await {
        return resp;
    }

    let limit = query
        .get("limit")
        .unwrap_or(&"100".to_string())
        .parse::<i64>()
        .unwrap_or(100);
    let offset = query
        .get("offset")
        .unwrap_or(&"0".to_string())
        .parse::<i64>()
        .unwrap_or(0);

    let logs = sqlx::query_as::<_, AuditLog>(
        "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await;

    match logs {
        Ok(logs) => HttpResponse::Ok().json(ApiResponse::success(logs)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<AuditLog>>::error(e.to_string())),
    }
}
