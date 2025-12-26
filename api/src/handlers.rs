use crate::{auth_service::require_auth, db, models::*};
use actix_web::{web, HttpResponse, Responder};
use sqlx::PgPool;

/// Вспомогательная функция для извлечения адреса пользователя из query параметров
pub fn extract_user_address_from_query(
    query: &web::Query<std::collections::HashMap<String, String>>,
) -> Option<String> {
    if let Some(pbkey) = query.get("pbkey") {
        return Some(pbkey.clone());
    }
    if let Some(address) = query.get("address") {
        return Some(address.clone());
    }
    if let Some(admin_addr) = query.get("admin_address") {
        return Some(admin_addr.clone());
    }
    if let Some(auditor_addr) = query.get("auditor_address") {
        return Some(auditor_addr.clone());
    }
    None
}

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}

pub async fn get_user_settlements(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let pbkey = match query.get("pbkey") {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("pbkey required".into()))
        }
    };

    // Проверяем авторизацию для просмотра расчетов
    if let Err(resp) = require_auth(&pool, pbkey, "view_own_settlements").await {
        return resp;
    }

    let rows = sqlx::query_as!(
        Settlement,
        r#"SELECT * FROM settlements
           WHERE from_address = $1 OR to_address = $1"#,
        pbkey
    )
    .fetch_all(pool.get_ref())
    .await;

    match rows {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

pub async fn pay_settlement(
    pool: web::Data<PgPool>,
    path: web::Path<i32>,
    body: web::Json<PayRequest>,
) -> impl Responder {
    let id = path.into_inner();

    let res = sqlx::query!(
        "UPDATE settlements SET tx_signature=$1 WHERE id=$2",
        body.tx_signature,
        id
    )
    .execute(pool.get_ref())
    .await;

    match res {
        Ok(_) => HttpResponse::Ok().json(ApiResponse::<String>::success("ok".into())),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

/// Получение общей информации о системе для гостей
pub async fn get_system_info(pool: web::Data<PgPool>) -> impl Responder {
    // Получаем статистику системы
    let stats = sqlx::query!(
        r#"
        SELECT
            (SELECT COUNT(*) FROM participants WHERE is_active = true) as total_users,
            (SELECT COUNT(*) FROM participants WHERE user_type = 'counterparty' AND is_active = true) as active_counterparties,
            (SELECT COUNT(*) FROM positions WHERE status = 'pending') as pending_positions,
            (SELECT COUNT(*) FROM positions WHERE status = 'confirmed') as confirmed_positions,
            (SELECT COUNT(*) FROM positions WHERE status = 'cleared') as cleared_positions,
            (SELECT COUNT(*) FROM netting_sessions) as total_clearing_sessions
        "#,
    )
    .fetch_one(pool.get_ref())
    .await;

    match stats {
        Ok(stats) => {
            let system_info = serde_json::json!({
                "total_users": stats.total_users,
                "active_counterparties": stats.active_counterparties,
                "pending_positions": stats.pending_positions,
                "confirmed_positions": stats.confirmed_positions,
                "cleared_positions": stats.cleared_positions,
                "total_clearing_sessions": stats.total_clearing_sessions,
                "system_description": "Система клиринга для проведения неттинга и расчетов между контрагентами на блокчейне Solana"
            });

            HttpResponse::Ok().json(ApiResponse::success(system_info))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<serde_json::Value>::error(e.to_string())),
    }
}

/// Получение системных настроек
pub async fn get_system_settings(pool: web::Data<PgPool>) -> impl Responder {
    let settings = db::get_system_settings(pool.get_ref()).await;

    match settings {
        Ok(settings) => HttpResponse::Ok().json(ApiResponse::success(settings)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<SystemSetting>::error(e.to_string())),
    }
}

/// Обновление системных настроек (только администратор)
pub async fn update_system_settings(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateSystemSettingsRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let admin_address = match query.get("admin_address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "admin_address parameter required".to_string(),
            ))
        }
    };

    // Проверяем права администратора
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "update_system_settings").await {
        return resp;
    }

    let result = db::update_system_settings(pool.get_ref(), &req).await;

    match result {
        Ok(setting) => HttpResponse::Ok().json(ApiResponse::success(setting)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<SystemSetting>::error(e.to_string())),
    }
}
