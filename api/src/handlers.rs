use crate::models::*;
use actix_web::{web, HttpResponse, Responder};
use chrono::Utc;
use sqlx::PgPool;

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}

pub async fn get_positions(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let status_filter = query.get("status");

    let positions = if let Some(status) = status_filter {
        sqlx::query_as::<_, Position>(
            "SELECT * FROM positions WHERE status = $1 ORDER BY created_at DESC",
        )
        .bind(status)
        .fetch_all(pool.get_ref())
        .await
    } else {
        sqlx::query_as::<_, Position>("SELECT * FROM positions ORDER BY created_at DESC")
            .fetch_all(pool.get_ref())
            .await
    };

    match positions {
        Ok(positions) => HttpResponse::Ok().json(ApiResponse::success(positions)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<Position>>::error(e.to_string())),
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
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<Position>::error(
            "Position not found".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn create_position(
    pool: web::Data<PgPool>,
    req: web::Json<CreatePositionRequest>,
    _solana_rpc: web::Data<String>,
) -> impl Responder {
    // В реальном приложении здесь должна быть валидация подписи
    let position = sqlx::query_as::<_, Position>(
        r#"
        INSERT INTO positions (creator_address, counterparty_address, amount, status, transaction_signature)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING *
        "#
    )
    .bind("") // В реальном приложении извлекать из подписи
    .bind(&req.counterparty_address)
    .bind(req.amount)
    .bind(req.signature.as_ref())
    .fetch_one(pool.get_ref())
    .await;

    match position {
        Ok(position) => HttpResponse::Created().json(ApiResponse::success(position)),
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
        return HttpResponse::BadRequest().json(ApiResponse::<Position>::error(
            "No fields to update".to_string(),
        ));
    };

    match position {
        Ok(Some(position)) => HttpResponse::Ok().json(ApiResponse::success(position)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<Position>::error(
            "Position not found".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn delete_position(pool: web::Data<PgPool>, path: web::Path<i64>) -> impl Responder {
    let id = path.into_inner();

    let result = sqlx::query("DELETE FROM positions WHERE id = $1")
        .bind(id)
        .execute(pool.get_ref())
        .await;

    match result {
        Ok(result) if result.rows_affected() > 0 => {
            HttpResponse::Ok().json(ApiResponse::success("Position deleted"))
        }
        Ok(_) => HttpResponse::NotFound().json(ApiResponse::<String>::error(
            "Position not found".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

pub async fn confirm_position(pool: web::Data<PgPool>, path: web::Path<i64>) -> impl Responder {
    let id = path.into_inner();

    let position = sqlx::query_as::<_, Position>(
        r#"
        UPDATE positions 
        SET status = 'confirmed', confirmed_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING *
        "#,
    )
    .bind(id)
    .fetch_optional(pool.get_ref())
    .await;

    match position {
        Ok(Some(position)) => HttpResponse::Ok().json(ApiResponse::success(position)),
        Ok(None) => HttpResponse::BadRequest().json(ApiResponse::<Position>::error(
            "Position not found or cannot be confirmed".to_string(),
        )),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(e.to_string()))
        }
    }
}

pub async fn execute_clearing(pool: web::Data<PgPool>, path: web::Path<i64>) -> impl Responder {
    let id = path.into_inner();

    // Начинаем транзакцию
    let mut tx = pool.begin().await.unwrap();

    // Получаем позицию
    let position =
        sqlx::query_as::<_, Position>("SELECT * FROM positions WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await;

    let position = match position {
        Ok(Some(p)) if p.status == "confirmed" => p,
        Ok(Some(_)) => {
            tx.rollback().await.unwrap();
            return HttpResponse::BadRequest().json(ApiResponse::<Position>::error(
                "Position must be confirmed".to_string(),
            ));
        }
        Ok(None) => {
            tx.rollback().await.unwrap();
            return HttpResponse::NotFound().json(ApiResponse::<Position>::error(
                "Position not found".to_string(),
            ));
        }
        Err(e) => {
            tx.rollback().await.unwrap();
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<Position>::error(e.to_string()));
        }
    };

    // Обновляем балансы участников
    sqlx::query(
        r#"
        INSERT INTO participants (address, balance, updated_at)
        VALUES ($1, -$3, NOW()), ($2, $3, NOW())
        ON CONFLICT (address) 
        DO UPDATE SET balance = participants.balance + EXCLUDED.balance, updated_at = NOW()
        "#,
    )
    .bind(&position.creator_address)
    .bind(&position.counterparty_address)
    .bind(position.amount)
    .execute(&mut *tx)
    .await
    .unwrap();

    // Обновляем статус позиции
    let updated = sqlx::query_as::<_, Position>(
        r#"
        UPDATE positions 
        SET status = 'cleared', cleared_at = NOW()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();

    match updated {
        Some(position) => HttpResponse::Ok().json(ApiResponse::success(position)),
        None => HttpResponse::InternalServerError().json(ApiResponse::<Position>::error(
            "Failed to update position".to_string(),
        )),
    }
}

pub async fn get_participants(pool: web::Data<PgPool>) -> impl Responder {
    let participants =
        sqlx::query_as::<_, Participant>("SELECT * FROM participants ORDER BY created_at DESC")
            .fetch_all(pool.get_ref())
            .await;

    match participants {
        Ok(participants) => HttpResponse::Ok().json(ApiResponse::success(participants)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<Participant>>::error(e.to_string())),
    }
}

pub async fn get_participant(pool: web::Data<PgPool>, path: web::Path<String>) -> impl Responder {
    let address = path.into_inner();

    let participant =
        sqlx::query_as::<_, Participant>("SELECT * FROM participants WHERE address = $1")
            .bind(&address)
            .fetch_optional(pool.get_ref())
            .await;

    match participant {
        Ok(Some(participant)) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<Participant>::error(
            "Participant not found".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

pub async fn get_balance(pool: web::Data<PgPool>, path: web::Path<String>) -> impl Responder {
    let address = path.into_inner();

    let participant =
        sqlx::query_as::<_, Participant>("SELECT * FROM participants WHERE address = $1")
            .bind(&address)
            .fetch_optional(pool.get_ref())
            .await;

    match participant {
        Ok(Some(p)) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
            "address": p.address,
            "balance": p.balance,
            "margin": p.margin
        }))),
        Ok(None) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
            "address": address,
            "balance": 0,
            "margin": 0
        }))),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<serde_json::Value>::error(e.to_string())),
    }
}

pub async fn multi_party_clearing(
    pool: web::Data<PgPool>,
    req: web::Json<MultiPartyClearingRequest>,
) -> impl Responder {
    if req.participants.len() != req.amounts.len() || req.participants.len() < 2 {
        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
            "Invalid participants or amounts".to_string(),
        ));
    }

    // Расчет чистых позиций (netting)
    let net_amounts: Vec<i64> = req.amounts.clone();

    let clearing_id = format!("clearing_{}", Utc::now().timestamp());

    let result = sqlx::query(
        r#"
        INSERT INTO clearing_history (clearing_id, participants, amounts, net_amounts, status)
        VALUES ($1, $2, $3, $4, 'calculated')
        RETURNING id
        "#,
    )
    .bind(&clearing_id)
    .bind(&req.participants)
    .bind(&req.amounts)
    .bind(&net_amounts)
    .fetch_one(pool.get_ref())
    .await;

    match result {
        Ok(_) => HttpResponse::Created().json(ApiResponse::success(serde_json::json!({
            "clearing_id": clearing_id,
            "participants": req.participants,
            "amounts": req.amounts,
            "net_amounts": net_amounts,
            "status": "calculated"
        }))),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<serde_json::Value>::error(e.to_string())),
    }
}

pub async fn deposit_margin(
    pool: web::Data<PgPool>,
    req: web::Json<MarginRequest>,
) -> impl Responder {
    // В реальном приложении здесь должна быть валидация подписи и адреса
    let address = ""; // Извлекать из подписи

    let participant = sqlx::query_as::<_, Participant>(
        r#"
        INSERT INTO participants (address, margin, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (address) 
        DO UPDATE SET margin = participants.margin + $2, updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(address)
    .bind(req.amount as i64)
    .fetch_optional(pool.get_ref())
    .await;

    match participant {
        Ok(Some(p)) => HttpResponse::Ok().json(ApiResponse::success(p)),
        Ok(None) => HttpResponse::InternalServerError().json(ApiResponse::<Participant>::error(
            "Failed to deposit margin".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

pub async fn withdraw_margin(
    pool: web::Data<PgPool>,
    req: web::Json<MarginRequest>,
) -> impl Responder {
    // В реальном приложении здесь должна быть валидация подписи и адреса
    let address = ""; // Извлекать из подписи

    let participant = sqlx::query_as::<_, Participant>(
        r#"
        UPDATE participants 
        SET margin = margin - $2, updated_at = NOW()
        WHERE address = $1 AND margin >= $2
        RETURNING *
        "#,
    )
    .bind(address)
    .bind(req.amount as i64)
    .fetch_optional(pool.get_ref())
    .await;

    match participant {
        Ok(Some(p)) => HttpResponse::Ok().json(ApiResponse::success(p)),
        Ok(None) => HttpResponse::BadRequest().json(ApiResponse::<Participant>::error(
            "Insufficient margin or participant not found".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}
