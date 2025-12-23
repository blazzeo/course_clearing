use crate::auth_service::{get_user_role, register_guest, require_auth, UserRole};
use crate::models::{ApiResponse, Participant, RegisterParticipantRequest, UpdateProfileRequest};
use actix_web::{web, HttpResponse, Responder};
use sqlx::PgPool;
use std::{str::FromStr, sync::Arc};

/// Получение профиля пользователя
pub async fn get_profile(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    let participant = sqlx::query_as::<_, Participant>(
        "SELECT * FROM participants WHERE address = $1 AND is_active = true",
    )
    .bind(address)
    .fetch_one(pool.get_ref())
    .await;

    match participant {
        Ok(p) => HttpResponse::Ok().json(ApiResponse::success(p)),
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(
            ApiResponse::<Participant>::error("Participant not found".to_string()),
        ),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

/// Обновление профиля пользователя
pub async fn update_profile(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateProfileRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    // Проверяем права на обновление профиля
    // Гости могут обновлять только свой профиль
    let user_role = match get_user_role(pool.get_ref(), address).await {
        Ok(role) => role,
        Err(_) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                "Failed to get user role".to_string(),
            ))
        }
    };

    match user_role {
        UserRole::Guest => {
            // Гости могут обновлять только базовую информацию своего профиля
            // Без дополнительных проверок прав
        }
        _ => {
            // Для других ролей проверяем право update_profile
            if let Err(resp) = require_auth(pool.get_ref(), address, "update_profile").await {
                return resp;
            }
        }
    }

    let result = sqlx::query_as::<_, Participant>(
        r#"
        UPDATE participants
        SET email = COALESCE($1, email),
            first_name = COALESCE($2, first_name),
            last_name = COALESCE($3, last_name),
            phone = COALESCE($4, phone),
            company = COALESCE($5, company),
            updated_at = NOW()
        WHERE address = $6 AND is_active = true
        RETURNING *
        "#,
    )
    .bind(&req.email)
    .bind(&req.first_name)
    .bind(&req.last_name)
    .bind(&req.phone)
    .bind(&req.company)
    .bind(address)
    .fetch_one(pool.get_ref())
    .await;

    match result {
        Ok(participant) => HttpResponse::Ok().json(ApiResponse::success(participant)),
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(
            ApiResponse::<Participant>::error("Participant not found".to_string()),
        ),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Participant>::error(e.to_string())),
    }
}

/// Регистрация гостя (автоматическая)
pub async fn register_guest_handler(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<RegisterParticipantRequest>,
) -> impl Responder {
    // Парсим адрес Solana
    let user_pubkey = match solana_sdk::pubkey::Pubkey::from_str(&req.address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Invalid address format".to_string(),
            ))
        }
    };

    // Регистрируем гостя в базе данных
    let participant = match register_guest(pool.get_ref(), &req.address).await {
        Ok(p) => p,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<Participant>::error(e.to_string()))
        }
    };

    // Проверяем, инициализирован ли участник в смарт-контракте
    let is_initialized = match blockchain_client
        .is_participant_initialized(&user_pubkey)
        .await
    {
        Ok(initialized) => initialized,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to check blockchain state: {}",
                e
            )))
        }
    };

    if is_initialized {
        // Участник уже инициализирован в смарт-контракте
        HttpResponse::Created().json(ApiResponse::success(serde_json::json!({
            "participant": participant,
            "blockchain_initialized": true,
            "message": "Guest registered and blockchain account already initialized"
        })))
    } else {
        // Участник не инициализирован в смарт-контракте - создаем инструкцию
        let instruction = match blockchain_client
            .create_initialize_participant_instruction(&user_pubkey)
            .await
        {
            Ok(ix) => ix,
            Err(e) => {
                return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                    format!("Failed to create instruction: {}", e),
                ))
            }
        };

        HttpResponse::Created().json(ApiResponse::success(serde_json::json!({
            "participant": participant,
            "blockchain_initialized": false,
            "message": "Guest registered in database. Blockchain initialization required.",
            "instruction": {
                "program_id": instruction.program_id.to_string(),
                "accounts": instruction.accounts.iter().map(|acc| {
                    serde_json::json!({
                        "pubkey": acc.pubkey.to_string(),
                        "is_signer": acc.is_signer,
                        "is_writable": acc.is_writable,
                    })
                }).collect::<Vec<_>>(),
                "data": instruction.data,
            }
        })))
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

pub async fn register_participant(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<RegisterParticipantRequest>,
) -> impl Responder {
    let address = &req.address;

    // Парсим адрес Solana
    let user_pubkey = match solana_sdk::pubkey::Pubkey::from_str(address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Invalid address format".to_string(),
            ))
        }
    };

    // Проверяем, существует ли участник в базе данных
    let participant_exists = sqlx::query!(
        "SELECT COUNT(*) as count FROM participants WHERE address = $1",
        address
    )
    .fetch_one(pool.get_ref())
    .await;

    let participant_count = match participant_exists {
        Ok(result) => result.count.unwrap_or(0),
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Database error: {}",
                e
            )))
        }
    };

    // Если участник не существует в БД, создаем запись
    if participant_count == 0 {
        let result = sqlx::query!("INSERT INTO participants (address) VALUES ($1)", address)
            .execute(pool.get_ref())
            .await;

        if let Err(e) = result {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to create participant: {}", e),
            ));
        }
    }

    // Проверяем, инициализирован ли участник в смарт-контракте
    let is_initialized = match blockchain_client
        .is_participant_initialized(&user_pubkey)
        .await
    {
        Ok(initialized) => initialized,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to check blockchain state: {}",
                e
            )))
        }
    };

    if is_initialized {
        // Участник уже инициализирован в смарт-контракте
        HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
            "message": "Participant registered successfully",
            "blockchain_initialized": true
        })))
    } else {
        // Участник не инициализирован в смарт-контракте - создаем инструкцию
        let instruction = match blockchain_client
            .create_initialize_participant_instruction(&user_pubkey)
            .await
        {
            Ok(ix) => ix,
            Err(e) => {
                return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                    format!("Failed to create instruction: {}", e),
                ))
            }
        };

        HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
            "message": "Participant registered in database. Initialize on blockchain required.",
            "blockchain_initialized": false,
            "instruction": {
                "program_id": instruction.program_id.to_string(),
                "accounts": instruction.accounts.iter().map(|acc| {
                    serde_json::json!({
                        "pubkey": acc.pubkey.to_string(),
                        "is_signer": acc.is_signer,
                        "is_writable": acc.is_writable,
                    })
                }).collect::<Vec<_>>(),
                "data": instruction.data,
            }
        })))
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
