use std::{str::FromStr, sync::Arc};

use crate::{
    auth_service::{
        activate_user, deactivate_user, get_user_role, register_guest, require_auth,
        update_user_role, verify, UserRole,
    },
    db::collect_confirmed_positions,
    models::*,
};
use actix_web::{web, HttpResponse, Responder};
use chrono::Utc;
use serde::Serialize;
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;

/// Вспомогательная функция для извлечения адреса пользователя из query параметров
fn extract_user_address_from_query(
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

/// Функция для логирования действий пользователей для аудита
async fn log_audit_action(
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

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
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

/// Развертывание смарт-контракта клиринга (только администратор)
pub async fn deploy_clearing_contract(
    pool: web::Data<PgPool>,
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
    if let Err(resp) = require_auth(&pool, admin_address, "deploy_contract").await {
        return resp;
    }

    // В реальной реализации здесь был бы код для:
    // 1. Компиляции Solana программы (Anchor build)
    // 2. Создания keypair для программы
    // 3. Развертывания программы на Solana
    // 4. Сохранения program_id в настройках системы

    // Пока возвращаем заглушку
    let mock_deployment_result = serde_json::json!({
        "program_id": "ClearingService11111111111111111111111111111111",
        "deployment_status": "success",
        "message": "Smart contract deployed successfully (mock implementation)",
        "note": "In real implementation, this would deploy the actual Solana program"
    });

    // Логируем развертывание
    let _ = log_audit_action(
        &pool,
        admin_address,
        "deploy_contract",
        "smart_contract",
        Some("clearing_service"),
        None,
        Some(mock_deployment_result.clone()),
    )
    .await;

    HttpResponse::Ok().json(ApiResponse::success(mock_deployment_result))
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
                "Position must be confirmed".into(),
            ));
        }
        Ok(None) => {
            tx.rollback().await.unwrap();
            return HttpResponse::NotFound()
                .json(ApiResponse::<Position>::error("Position not found".into()));
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

pub async fn multi_party_clearing(pool: web::Data<PgPool>) -> impl Responder {
    use std::collections::HashMap;

    // 1. Берём подтверждённые позиции
    let positions = match collect_confirmed_positions(&pool).await {
        Ok(p) if !p.is_empty() => p,
        Ok(_) => {
            return HttpResponse::Ok().json(ApiResponse::<String>::success(
                "No confirmed positions".to_string(),
            ))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error(e.to_string()))
        }
    };

    // 2. Считаем net-сальдо
    let mut net: HashMap<String, i128> = HashMap::new();
    for p in &positions {
        *net.entry(p.creator_address.clone()).or_insert(0) -= p.amount as i128;
        *net.entry(p.counterparty_address.clone()).or_insert(0) += p.amount as i128;
    }

    // Фильтр 0
    let mut participants = Vec::new();
    let mut amounts = Vec::new();
    for (addr, amt) in net {
        if amt != 0 {
            participants.push(addr);
            amounts.push(amt as i64);
        }
    }

    if participants.len() < 2 {
        return HttpResponse::Ok().json(ApiResponse::<String>::success(
            "Nothing to clear".to_string(),
        ));
    }

    // 3. Запуск неттинга
    let resp = crate::ledger_engine::netting_clearing(&participants, &amounts);
    if !resp.success {
        return HttpResponse::InternalServerError()
            .json(ApiResponse::<String>::error("Netting failed".into()));
    }
    let settlements = resp.data.clone().unwrap_or_default();

    // 4. Начинаем транзакцию
    let tx = pool.begin().await.unwrap();

    // 5. Создаём сессию
    let session =
        sqlx::query!("INSERT INTO netting_sessions (status) VALUES ('calculated') RETURNING id")
            .fetch_one(pool.get_ref())
            .await
            .unwrap();

    let session_id = session.id;

    // 6. Записываем netting_results
    for i in 0..participants.len() {
        sqlx::query!(
            "INSERT INTO netting_results (session_id, participant_address, net_amount)
             VALUES ($1,$2,$3)",
            session_id,
            participants[i],
            amounts[i]
        )
        .execute(pool.get_ref())
        .await
        .unwrap();
    }

    // 7. Записываем settlements без tx_signature
    let mut settlement_records = Vec::new();
    for s in &settlements {
        let settlement_id: i32 = sqlx::query!(
            "INSERT INTO settlements (session_id, from_address, to_address, amount, tx_signature)
             VALUES ($1, $2, $3, $4, '') RETURNING id",
            session_id,
            s.from_address,
            s.to_address,
            s.amount,
        )
        .fetch_one(pool.get_ref())
        .await
        .unwrap()
        .id;

        settlement_records.push(serde_json::json!({
            "id": settlement_id,
            "from_address": s.from_address,
            "to_address": s.to_address,
            "amount": s.amount
        }));
    }

    // 8. Обновляем позиции → cleared
    sqlx::query!(
        "UPDATE positions SET status='cleared', cleared_at=now() WHERE status='confirmed'"
    )
    .execute(pool.get_ref())
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // Логируем запуск клиринга
    let _ = log_audit_action(
        &pool,
        "system", // Системное действие
        "run_clearing",
        "clearing_session",
        Some(&session_id.to_string()),
        None,
        Some(serde_json::json!({
            "positions_cleared": positions.len(),
            "settlements_created": settlements.len()
        })),
    )
    .await;

    // Возвращаем settlements с дополнительной информацией для финализации в блокчейне
    let response = serde_json::json!({
        "settlements": settlements,
        "settlement_records": settlement_records,
        "session_id": session_id,
        "message": "Clearing calculated in database. Use settlement records to finalize on blockchain if needed."
    });

    HttpResponse::Ok().json(ApiResponse::success(response))
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

// Новые обработчики для работы с ролями и профилями

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

/// Получение системных настроек
pub async fn get_system_settings(pool: web::Data<PgPool>) -> impl Responder {
    let settings = sqlx::query_as::<_, SystemSetting>("SELECT * FROM system_settings ORDER BY key")
        .fetch_all(pool.get_ref())
        .await;

    match settings {
        Ok(settings) => HttpResponse::Ok().json(ApiResponse::success(settings)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<SystemSetting>>::error(e.to_string())),
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

    let result = sqlx::query_as::<_, SystemSetting>(
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
    .bind(&req.key)
    .bind(&req.value)
    .bind(&req.description)
    .fetch_one(pool.get_ref())
    .await;

    match result {
        Ok(setting) => HttpResponse::Ok().json(ApiResponse::success(setting)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<SystemSetting>::error(e.to_string())),
    }
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

/// Получение балансов всех контрагентов (только аудитор и администратор)
pub async fn get_all_balances(
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
    if let Err(resp) = require_auth(pool.get_ref(), auditor_address, "view_balances").await {
        return resp;
    }

    #[derive(Serialize)]
    struct BalancesOutput {
        pub address: String,
        pub balance: Option<i64>,
        pub user_type: String,
        pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let balances = sqlx::query_as!(
        BalancesOutput,
        r#"
        SELECT address, balance, user_type, updated_at
        FROM participants
        WHERE is_active = true AND user_type = 'counterparty'
        ORDER BY address
        "#,
    )
    .fetch_all(pool.get_ref())
    .await;

    match balances {
        Ok(balances) => HttpResponse::Ok().json(ApiResponse::success(balances)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<serde_json::Value>>::error(e.to_string())),
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

/// Депозит средств в смарт-контракт
pub async fn deposit_funds(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<DepositFundsRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let user_address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    // Проверяем авторизацию
    if let Err(resp) = require_auth(&pool, user_address, "deposit_funds").await {
        return resp;
    }

    // Создаем инструкцию для депозита
    let user_pubkey = match solana_sdk::pubkey::Pubkey::from_str(user_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("Invalid address".to_string()))
        }
    };

    let instruction = match blockchain_client
        .create_deposit_instruction(&user_pubkey, req.amount)
        .await
    {
        Ok(ix) => ix,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to create instruction: {}",
                e
            )))
        }
    };

    // В реальной реализации здесь нужно получить подписанную транзакцию от frontend
    // Пока возвращаем инструкцию для подписи на frontend
    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
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
        },
        "amount": req.amount,
        "message": "Use this instruction data to create and sign a transaction on the frontend"
    })))
}

/// Запрос на вывод средств
pub async fn request_withdrawal(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<WithdrawalRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let user_address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    // Проверяем авторизацию
    if let Err(resp) = require_auth(&pool, user_address, "request_withdrawal").await {
        return resp;
    }

    // Создаем инструкцию для запроса вывода
    let user_pubkey = match solana_sdk::pubkey::Pubkey::from_str(user_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("Invalid address".to_string()))
        }
    };

    let instruction = match blockchain_client
        .create_request_withdrawal_instruction(&user_pubkey, req.amount)
        .await
    {
        Ok(ix) => ix,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to create instruction: {}",
                e
            )))
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
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
        },
        "amount": req.amount,
        "message": "Use this instruction data to create and sign a transaction on the frontend"
    })))
}

/// Одобрение вывода средств (администратор)
pub async fn approve_withdrawal(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<ApproveWithdrawalRequest>,
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
    if let Err(resp) = require_auth(&pool, admin_address, "approve_withdrawal").await {
        return resp;
    }

    // Создаем инструкцию для одобрения вывода
    let withdrawal_pubkey = match solana_sdk::pubkey::Pubkey::from_str(&req.withdrawal_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Invalid withdrawal address".to_string(),
            ))
        }
    };

    let admin_pubkey = match solana_sdk::pubkey::Pubkey::from_str(admin_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Invalid admin address".to_string(),
            ))
        }
    };

    let instruction = match blockchain_client
        .create_approve_withdrawal_instruction(&withdrawal_pubkey, &admin_pubkey)
        .await
    {
        Ok(ix) => ix,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to create instruction: {}",
                e
            )))
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
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
        },
        "message": "Use this instruction data to create and sign a transaction on the frontend (admin only)"
    })))
}

/// Получение баланса в блокчейне
pub async fn get_blockchain_balance(
    blockchain_client: web::Data<std::sync::Arc<crate::blockchain::BlockchainClient>>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => addr.clone(),
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    let pubkey = match Pubkey::from_str(&address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("Invalid address".to_string()))
        }
    };

    let client = blockchain_client.clone();

    // Получаем blockchain balance
    let blockchain_balance = match client.get_balance(&pubkey).await {
        Ok(balance) => balance,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<String>::error(format!("RPC error: {e}")));
        }
    };

    // Получаем contract balance из смарт-контракта
    let contract_balance = match client.get_participant_balance(&pubkey).await {
        Ok(balance) => balance,
        Err(e) => {
            tracing::warn!("Failed to get contract balance: {}", e);
            None
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(BlockchainBalanceResponse {
        blockchain_balance,
        contract_balance,
    }))
}
