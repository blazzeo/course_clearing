use super::log::log_audit_action;
use crate::auth_service::{require_auth, verify};
use crate::handlers::extract_user_address_from_query;
use crate::models::{
    ApiResponse, ConfirmPositionRequest, CreatePositionRequest, Position, UpdatePositionRequest,
};
use actix_web::{web, HttpResponse, Responder};
use chrono::Utc;
use sqlx::PgPool;

pub async fn confirm_position(
    pool: web::Data<PgPool>,
    path: web::Path<i32>,
    req: web::Json<ConfirmPositionRequest>,
) -> impl Responder {
    let position_id_url = path.into_inner();

    // 1. URL id must match body id
    if req.position_id != position_id_url {
        return HttpResponse::BadRequest().body("position_id mismatch");
    }

    // 2. Validate timestamp
    let now = Utc::now().timestamp();
    if (now - req.timestamp).abs() > 60 {
        return HttpResponse::BadRequest().body("Invalid or expired timestamp");
    }

    // 3. Load position
    let position = sqlx::query_as::<_, Position>("SELECT * FROM positions WHERE id = $1")
        .bind(position_id_url)
        .fetch_optional(pool.get_ref())
        .await;

    let position = match position {
        Ok(Some(pos)) => pos,
        Ok(None) => return HttpResponse::NotFound().body("Position not found"),
        Err(e) => {
            return HttpResponse::InternalServerError().body(format!("DB error: {}", e));
        }
    };

    // 4. Check if status = pending
    if position.status != "pending" {
        return HttpResponse::BadRequest().body("Position already confirmed or cleared");
    }

    // 5. Counterparty must be the one who confirms
    if position.counterparty_address != req.wallet {
        return HttpResponse::Unauthorized().body("Only counterparty can confirm this position");
    }

    // 6. Build deterministic message
    let message = format!("confirm:{};timestamp:{}", req.position_id, req.timestamp);

    // 7. Verify signature
    let authorized = verify(&req.wallet, &message, &req.signature);
    if !authorized {
        return HttpResponse::Unauthorized().body("Invalid signature");
    }

    // 8. Update position
    let updated = sqlx::query_as::<_, Position>(
        r#"
        UPDATE positions
        SET status = 'confirmed',
            confirmed_at = NOW(),
            counterparty_signature = $2
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(position_id_url)
    .bind(&req.signature)
    .fetch_one(pool.get_ref())
    .await;

    match updated {
        Ok(p) => {
            // Логируем подтверждение позиции
            let _ = log_audit_action(
                &pool,
                &req.wallet,
                "confirm_position",
                "position",
                Some(&position_id_url.to_string()),
                Some(serde_json::json!({"status": "pending"})),
                Some(serde_json::json!({"status": "confirmed"})),
            )
            .await;

            HttpResponse::Ok().json(ApiResponse::success(p))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn create_position(
    pool: web::Data<PgPool>,
    req: web::Json<CreatePositionRequest>,
) -> impl Responder {
    // Проверяем авторизацию для создания позиции
    if let Err(resp) = require_auth(&pool, &req.wallet, "create_position").await {
        return resp;
    }
    // 1. Validate timestamp
    let now = Utc::now().timestamp();
    if (now - req.payload.timestamp).abs() > 60 {
        return HttpResponse::BadRequest().body("Invalid or expired timestamp");
    }

    // 2. Build deterministic message (NOT JSON!)
    let message = format!(
        "counterparty:{};amount:{};timestamp:{}",
        req.payload.counterparty, req.payload.amount_lamports, req.payload.timestamp
    );

    // 3. Verify signature
    let authorized = verify(&req.wallet, &message, &req.signature);
    if !authorized {
        return HttpResponse::Unauthorized().body("Signature invalid");
    }

    // 4. Insert position
    let position = sqlx::query_as::<_, Position>(
        r#"
        INSERT INTO positions (creator_address, counterparty_address, amount, status, creator_signature)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING *
        "#
    )
    .bind(&req.wallet)               // creator
    .bind(&req.payload.counterparty) // counterparty
    .bind(req.payload.amount_lamports as i64)
    .bind(&req.signature)            // correct
    .fetch_one(pool.get_ref())
    .await;

    match position {
        Ok(position) => {
            // Логируем создание позиции
            let _ = log_audit_action(
                &pool,
                &req.wallet,
                "create_position",
                "position",
                Some(&position.id.to_string()),
                None,
                Some(serde_json::json!({
                    "counterparty": req.payload.counterparty,
                    "amount": req.payload.amount_lamports
                })),
            )
            .await;

            HttpResponse::Created().json(ApiResponse::success(position))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn update_position(
    pool: web::Data<PgPool>,
    path: web::Path<i64>,
    req: web::Json<UpdatePositionRequest>,
) -> impl Responder {
    let id = path.into_inner();

    // Простая реализация обновления - обновляем только статус или сумму
    let position = if let Some(ref status) = req.status {
        sqlx::query_as::<_, Position>("UPDATE positions SET status = $1 WHERE id = $2 RETURNING *")
            .bind(status)
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await
    } else if let Some(amount) = req.amount {
        sqlx::query_as::<_, Position>("UPDATE positions SET amount = $1 WHERE id = $2 RETURNING *")
            .bind(amount)
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await
    } else {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<Position>::error("No fields to update".into()));
    };

    match position {
        Ok(Some(position)) => HttpResponse::Ok().json(ApiResponse::success(position)),
        Ok(None) => HttpResponse::NotFound()
            .json(ApiResponse::<Position>::error("Position not found".into())),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn delete_position(
    pool: web::Data<PgPool>,
    path: web::Path<i64>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let id = path.into_inner();

    // Извлекаем адрес пользователя
    let user_address = match extract_user_address_from_query(&query) {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "User address required".to_string(),
            ))
        }
    };

    // Проверяем авторизацию
    if let Err(resp) = require_auth(&pool, &user_address, "cancel_position").await {
        return resp;
    }

    // Получаем позицию для проверки прав
    let position = sqlx::query_as::<_, Position>("SELECT * FROM positions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await;

    let position = match position {
        Ok(Some(p)) => p,
        Ok(None) => {
            return HttpResponse::NotFound().json(ApiResponse::<String>::error(
                "Position not found".to_string(),
            ))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error(e.to_string()))
        }
    };

    // Проверяем, что пользователь может удалять только свою позицию
    if position.creator_address != user_address {
        return HttpResponse::Forbidden().json(ApiResponse::<String>::error(
            "Can only cancel own positions".to_string(),
        ));
    }

    // Проверяем, что позиция не подтверждена и не очищена
    if position.status != "pending" {
        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
            "Can only cancel pending positions".to_string(),
        ));
    }

    let result = sqlx::query("DELETE FROM positions WHERE id = $1")
        .bind(id)
        .execute(pool.get_ref())
        .await;

    match result {
        Ok(result) if result.rows_affected() > 0 => {
            // Логируем удаление позиции
            let _ = log_audit_action(
                &pool,
                &user_address,
                "delete_position",
                "position",
                Some(&id.to_string()),
                Some(serde_json::json!({"status": "pending"})),
                Some(serde_json::json!({"status": "deleted"})),
            )
            .await;

            HttpResponse::Ok().json(ApiResponse::success("Position deleted"))
        }
        Ok(_) => {
            HttpResponse::NotFound().json(ApiResponse::<String>::error("Position not found".into()))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

pub async fn get_position(pool: web::Data<PgPool>, path: web::Path<i64>) -> impl Responder {
    let id = path.into_inner();

    let position = sqlx::query_as::<_, Position>("SELECT * FROM positions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool.get_ref())
        .await;

    match position {
        Ok(Some(position)) => HttpResponse::Ok().json(ApiResponse::success(position)),
        Ok(None) => HttpResponse::NotFound()
            .json(ApiResponse::<Position>::error("Position not found".into())),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn get_positions(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let status_filter = query.get("status");
    let public_key = query.get("pbkey");

    // Проверяем авторизацию для просмотра позиций
    if let Some(pbkey) = public_key {
        if let Err(resp) = require_auth(&pool, pbkey, "view_own_positions").await {
            return resp;
        }
    }

    let positions = if let Some(status) = status_filter {
        sqlx::query_as::<_, Position>(
            "SELECT * FROM positions WHERE status = $1 AND (creator_address = $2 OR counterparty_address = $2) ORDER BY created_at DESC",
        )
        .bind(status)
        .bind(public_key)
        .fetch_all(pool.get_ref())
        .await
    } else {
        sqlx::query_as::<_, Position>("SELECT * FROM positions WHERE creator_address = $1 OR counterparty_address = $1 ORDER BY created_at DESC")
            .bind(public_key)
            .fetch_all(pool.get_ref())
            .await
    };

    match positions {
        Ok(positions) => HttpResponse::Ok().json(ApiResponse::success(positions)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<Position>>::error(e.to_string())),
    }
}
