use crate::auth_service::{
    activate_user, deactivate_user, require_auth, update_user_role, UserRole,
};
use crate::endpoints::log::log_audit_action;
use crate::models::{
    ApiResponse, DeactivateParticipantRequest, Participant, RegisterParticipantRequest,
    UpdateUserTypeRequest,
};
use actix_web::{web, HttpResponse, Responder};
use sqlx::PgPool;

/// Деактивация пользователя (только администратор)
pub async fn deactivate_participant(
    pool: web::Data<PgPool>,
    req: web::Json<DeactivateParticipantRequest>,
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
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "deactivate_user").await {
        return resp;
    }

    match deactivate_user(pool.get_ref(), &req.address).await {
        Ok(participant) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(
            ApiResponse::<Participant>::error("Participant not found".to_string()),
        ),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

/// Активация пользователя (только администратор)
pub async fn activate_participant(
    pool: web::Data<PgPool>,
    req: web::Json<RegisterParticipantRequest>,
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
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "activate_user").await {
        return resp;
    }

    match activate_user(pool.get_ref(), &req.address).await {
        Ok(participant) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(
            ApiResponse::<Participant>::error("Participant not found".to_string()),
        ),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

/// Изменение роли пользователя (только администратор)
pub async fn change_user_role(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateUserTypeRequest>,
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
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "change_user_role").await {
        return resp;
    }

    let new_role = match UserRole::from_str(&req.user_type) {
        Some(role) => role,
        None => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("Invalid role".to_string()))
        }
    };

    match update_user_role(pool.get_ref(), &req.address, &new_role).await {
        Ok(participant) => {
            // Логируем изменение роли
            let _ = log_audit_action(
                &pool,
                admin_address,
                "change_user_role",
                "user",
                Some(&req.address),
                None,
                Some(serde_json::json!({"new_role": new_role.to_string()})),
            )
            .await;

            HttpResponse::Ok().json(ApiResponse::success(participant))
        }
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(
            ApiResponse::<Participant>::error("Participant not found".to_string()),
        ),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

pub async fn check_admin_status(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
) -> impl Responder {
    let address = path.into_inner();

    let participant =
        sqlx::query_as::<_, Participant>("SELECT * FROM participants WHERE address = $1")
            .bind(&address)
            .fetch_optional(pool.get_ref())
            .await;

    match participant {
        Ok(Some(p)) => {
            let is_admin = p.user_type == "administrator";
            HttpResponse::Ok().json(ApiResponse::success(is_admin))
        }
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<bool>::error(
            "Participant not found".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<bool>::error(e.to_string()))
        }
    }
}

pub async fn remove_admin(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateUserTypeRequest>,
) -> impl Responder {
    // Обновляем тип пользователя на counterparty
    let result = sqlx::query_as::<_, Participant>(
        "UPDATE participants SET user_type = 'counterparty' WHERE address = $1 RETURNING *",
    )
    .bind(&req.address)
    .fetch_optional(pool.get_ref())
    .await;

    match result {
        Ok(Some(participant)) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<Participant>::error(
            "Participant not found".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

pub async fn get_admins(pool: web::Data<PgPool>) -> impl Responder {
    let admins = sqlx::query_as::<_, Participant>(
        "SELECT * FROM participants WHERE user_type = 'administrator' ORDER BY created_at DESC",
    )
    .fetch_all(pool.get_ref())
    .await;

    match admins {
        Ok(admins) => HttpResponse::Ok().json(ApiResponse::success(admins)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<Participant>>::error(e.to_string())),
    }
}

pub async fn add_admin(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateUserTypeRequest>,
) -> impl Responder {
    // Проверяем, что пользователь существует
    let participant_exists = sqlx::query!(
        "SELECT COUNT(*) as count FROM participants WHERE address = $1",
        req.address
    )
    .fetch_one(pool.get_ref())
    .await;

    match participant_exists {
        Ok(result) if result.count == Some(0) => {
            return HttpResponse::NotFound().json(ApiResponse::<String>::error(
                "Participant not found".to_string(),
            ));
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error(e.to_string()));
        }
        _ => {}
    }

    // Обновляем тип пользователя на admin
    let result = sqlx::query_as::<_, Participant>(
        "UPDATE participants SET user_type = 'administrator' WHERE address = $1 RETURNING *",
    )
    .bind(&req.address)
    .fetch_optional(pool.get_ref())
    .await;

    match result {
        Ok(Some(participant)) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<Participant>::error(
            "Participant not found".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

/// Удаление контрагента (только администратор)
pub async fn delete_participant(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = path.into_inner();
    let admin_address = match query.get("admin_address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "admin_address parameter required".to_string(),
            ))
        }
    };

    // Проверяем права администратора
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "delete_user").await {
        return resp;
    }

    // Проверяем, что у пользователя нет активных позиций
    let active_positions = sqlx::query!(
        "SELECT COUNT(*) as count FROM positions WHERE (creator_address = $1 OR counterparty_address = $1) AND status IN ('pending', 'confirmed')",
        address
    )
    .fetch_one(pool.get_ref())
    .await;

    match active_positions {
        Ok(result) if result.count > Some(0) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Cannot delete participant with active positions".to_string(),
            ));
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error(e.to_string()))
        }
        _ => {}
    }

    let result = sqlx::query("DELETE FROM participants WHERE address = $1")
        .bind(&address)
        .execute(pool.get_ref())
        .await;

    match result {
        Ok(result) if result.rows_affected() > 0 => {
            HttpResponse::Ok().json(ApiResponse::success("Participant deleted"))
        }
        Ok(_) => HttpResponse::NotFound().json(ApiResponse::<String>::error(
            "Participant not found".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}
