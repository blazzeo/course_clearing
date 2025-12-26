use super::log::log_audit_action;
use crate::auth_service::require_auth;
use crate::models::{
    ApiResponse, ApproveWithdrawalRequest, BlockchainBalanceResponse, CompleteWithdrawalRequest,
    ConfirmWithdrawalRequest, DepositFundsRequest, EscrowBalanceResponse, WithdrawalRequest,
};
use actix_web::{web, HttpResponse, Responder};
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;
use std::{str::FromStr, sync::Arc};

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

    // Проверяем, что escrow инициализирован
    let is_escrow_initialized = match blockchain_client.is_escrow_initialized().await {
        Ok(initialized) => initialized,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to check escrow status: {}",
                e
            )))
        }
    };

    if !is_escrow_initialized {
        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
            "Escrow not initialized. Please initialize escrow first.".to_string(),
        ));
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
/// Создание инструкции для запроса вывода средств (без сохранения в БД)
pub async fn request_withdrawal_instruction(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<WithdrawalRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let user_address = match query.get("address") {
        Some(addr) => {
            tracing::info!(
                "Request withdrawal instruction for address: {}, amount: {}",
                addr,
                req.amount
            );
            addr
        }
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

    // Проверяем, что участник инициализирован в смарт-контракте
    let user_pubkey = match solana_sdk::pubkey::Pubkey::from_str(user_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<String>::error("Invalid address".to_string()))
        }
    };

    let is_participant_valid = match blockchain_client.is_participant_valid(&user_pubkey).await {
        Ok(valid) => {
            tracing::info!(
                "Participant validation result for {}: {}",
                user_address,
                valid
            );
            valid
        }
        Err(e) => {
            tracing::error!("Failed to validate participant {}: {}", user_address, e);
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to check participant status: {}", e),
            ));
        }
    };

    if !is_participant_valid {
        // Участник не инициализирован - возвращаем инструкцию для инициализации
        let init_instruction = match blockchain_client
            .create_initialize_participant_instruction(&user_pubkey)
            .await
        {
            Ok(ix) => ix,
            Err(e) => {
                return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                    format!(
                        "Failed to create participant initialization instruction: {}",
                        e
                    ),
                ))
            }
        };

        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(format!(
            "Participant not initialized in blockchain. Please initialize first using this instruction: {}",
            serde_json::to_string(&serde_json::json!({
                "program_id": init_instruction.program_id.to_string(),
                "accounts": init_instruction.accounts.iter().map(|acc| {
                    serde_json::json!({
                        "pubkey": acc.pubkey.to_string(),
                        "is_signer": acc.is_signer,
                        "is_writable": acc.is_writable,
                    })
                }).collect::<Vec<_>>(),
                "data": init_instruction.data,
            })).unwrap()
        )));
    }

    // Создаем инструкцию для запроса вывода
    let (instruction, withdrawal_pda) = match blockchain_client
        .create_request_withdrawal_instruction(&user_pubkey, req.amount)
        .await
    {
        Ok(ix) => {
            tracing::info!(
                "Successfully created withdrawal instruction for {}",
                user_address
            );
            ix
        }
        Err(e) => {
            tracing::error!(
                "Failed to create withdrawal instruction for {}: {}",
                user_address,
                e
            );
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to create instruction: {}", e),
            ));
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
        "message": "Use this instruction data to create and sign a transaction on the frontend",
        "pda": withdrawal_pda
    })))
}

/// Подтверждение успешного создания запроса на вывод средств (сохранение в БД)
pub async fn confirm_withdrawal(
    pool: web::Data<PgPool>,
    req: web::Json<ConfirmWithdrawalRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let user_address = match query.get("address") {
        Some(addr) => {
            tracing::info!(
                "Confirming withdrawal for address: {}, amount: {}, tx_signature: {}",
                addr,
                req.amount,
                req.tx_signature
            );
            addr
        }
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    // Проверяем авторизацию
    if let Err(resp) = require_auth(&pool, user_address, "confirm_withdrawal").await {
        return resp;
    }

    // Получаем текущий nonce из количества withdrawals для этого участника
    let current_nonce = match sqlx::query!(
        "SELECT COUNT(*) as count FROM withdrawals WHERE participant = $1",
        user_address
    )
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record.count.unwrap_or(0) as i64,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to get withdrawal count: {}", e),
            ));
        }
    };

    tracing::info!(
        "Confirm withdrawal - calculated nonce: {}, PDA will be calculated as: find_program_address([b\"withdrawal\", {}, {}], {})",
        current_nonce,
        user_address,
        format!("{:?}", (current_nonce as u64).to_le_bytes()),
        "PROGRAM_ID"
    );

    // Сохраняем запрос на вывод в базу данных
    let withdrawal_result = sqlx::query!(
        "INSERT INTO withdrawals (participant, amount, status, nonce, tx_signature, pda) VALUES ($1, $2, 'pending', $3, $4, $5) RETURNING id",
        user_address,
        req.amount,
        current_nonce,
        req.tx_signature,
        req.pda
    )
    .fetch_one(pool.get_ref())
    .await;

    let withdrawal_id = match withdrawal_result {
        Ok(record) => record.id,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to save withdrawal request: {}", e),
            ));
        }
    };

    // Логируем создание запроса на вывод
    let _ = log_audit_action(
        &pool,
        user_address,
        "confirm_withdrawal",
        "withdrawal",
        Some(&withdrawal_id.to_string()),
        None,
        Some(serde_json::json!({"status": "pending", "amount": req.amount, "tx_signature": req.tx_signature})),
    )
    .await;

    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
        "withdrawal_id": withdrawal_id,
        "message": "Withdrawal request confirmed and saved to database"
    })))
}

/// Завершение вывода средств (после успешной транзакции)
pub async fn complete_withdrawal(
    pool: web::Data<PgPool>,
    req: web::Json<CompleteWithdrawalRequest>,
) -> impl Responder {
    // Обновляем статус withdrawal в БД
    let result = sqlx::query!(
        r#"
        UPDATE withdrawals
        SET status = 'completed',
            tx_signature = $2,
            completed_at = NOW()
        WHERE pda = $1 AND status = 'pending'
        RETURNING id
        "#,
        req.withdrawal_pda,
        req.tx_signature
    )
    .fetch_optional(pool.get_ref())
    .await;

    match result {
        Ok(Some(record)) => {
            // Логируем завершение вывода
            let _ = log_audit_action(
                &pool,
                &req.user_address,
                "complete_withdrawal",
                "withdrawal",
                Some(&record.id.to_string()),
                Some(serde_json::json!({"status": "pending"})),
                Some(serde_json::json!({"status": "completed", "tx_signature": req.tx_signature})),
            )
            .await;

            HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
                "message": "Withdrawal completed successfully",
                "withdrawal_id": record.id
            })))
        }
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<String>::error(
            "Withdrawal not found or already completed".to_string(),
        )),
        Err(e) => HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
            "Failed to complete withdrawal: {}",
            e
        ))),
    }
}

/// Одобрение вывода средств (администратор)
pub async fn approve_withdrawal(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    req: web::Json<ApproveWithdrawalRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    tracing::info!(
        "Approving withdrawal for address: {}, withdrawal_pad: {:?}",
        req.withdrawal_address,
        req.withdrawal_pda
    );

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

    // Проверяем, что escrow инициализирован
    let is_escrow_initialized = match blockchain_client.is_escrow_initialized().await {
        Ok(initialized) => initialized,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to check escrow status: {}",
                e
            )))
        }
    };

    if !is_escrow_initialized {
        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
            "Escrow not initialized. Please initialize escrow first.".to_string(),
        ));
    }

    // Получаем withdrawal из базы данных
    #[derive(Debug)]
    struct WithdrawalRecord {
        // id: i32,
        // status: String,
        // nonce: Option<i64>,
        pda: Option<String>,
    }

    let withdrawal_record = if let Some(withdrawal_pda) = &req.withdrawal_pda {
        // Используем указанный ID
        match sqlx::query_as!(
            WithdrawalRecord,
            "SELECT pda FROM withdrawals WHERE pda = $1 AND participant = $2",
            withdrawal_pda,
            req.withdrawal_address
        )
        .fetch_optional(pool.get_ref())
        .await
        {
            Ok(Some(record)) => record,
            Ok(None) => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "Withdrawal not found".to_string(),
                ))
            }
            Err(e) => {
                return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                    format!("Failed to check withdrawal: {}", e),
                ))
            }
        }
    } else {
        // Ищем pending withdrawal
        match sqlx::query_as!(
            WithdrawalRecord,
            "SELECT pda FROM withdrawals WHERE participant = $1 AND status = 'pending' ORDER BY requested_at DESC LIMIT 1",
            req.withdrawal_address
        )
        .fetch_optional(pool.get_ref())
        .await
        {
            Ok(Some(record)) => record,
            Ok(None) => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "No pending withdrawal found for this address".to_string(),
                ))
            }
            Err(e) => {
                return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                    "Failed to check withdrawal status: {}",
                    e
                )))
            }
        }
    };

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

    let withdrawal_pda = match withdrawal_record.pda {
        Some(pda) => pda,
        None => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to get Transaction PDA from db",
            )))
        }
    };

    let instruction = match blockchain_client
        .create_approve_withdrawal_instruction(
            &withdrawal_pubkey,
            &withdrawal_pubkey,
            &admin_pubkey,
            &withdrawal_pda,
        )
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
        "message": "Use this instruction data to create and sign a transaction on the frontend (admin only)",
        "pda": withdrawal_pda
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

/// Инициализация escrow аккаунта (только администратор)
pub async fn initialize_escrow(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
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
    if let Err(resp) = require_auth(&pool, admin_address, "initialize_escrow").await {
        return resp;
    }

    // Проверяем, инициализирован ли уже escrow
    let is_initialized = match blockchain_client.is_escrow_initialized().await {
        Ok(initialized) => initialized,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to check escrow state: {}",
                e
            )))
        }
    };

    if is_initialized {
        return HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
            "message": "Escrow already initialized",
            "initialized": true
        })));
    }

    // Создаем инструкцию для инициализации escrow
    let admin_pubkey = match solana_sdk::pubkey::Pubkey::from_str(admin_address) {
        Ok(pk) => pk,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Invalid admin address".to_string(),
            ))
        }
    };

    let instruction = match blockchain_client
        .create_initialize_escrow_instruction(&admin_pubkey)
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
        "message": "Escrow initialization required",
        "initialized": false,
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

/// Получить статус участника (баланс, долги, блокировка)
pub async fn get_participant_status(
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => match Pubkey::from_str(addr) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "Invalid address format".into(),
                ))
            }
        },
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".into(),
            ))
        }
    };

    match blockchain_client.get_participant_status(&address).await {
        Ok(Some(status)) => HttpResponse::Ok().json(ApiResponse::success(status)),
        Ok(None) => HttpResponse::NotFound()
            .json(ApiResponse::<String>::error("Participant not found".into())),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

/// Получить список долгов пользователя
pub async fn get_outstanding_fees(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".into(),
            ))
        }
    };

    match crate::db::get_outstanding_fees(&pool, address).await {
        Ok(fees) => HttpResponse::Ok().json(ApiResponse::success(fees)),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

/// Создать инструкцию для погашения долгов
pub async fn create_repay_fees_instruction(
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => match Pubkey::from_str(addr) {
            Ok(pubkey) => pubkey,
            Err(_) => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "Invalid address format".into(),
                ))
            }
        },
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".into(),
            ))
        }
    };

    match blockchain_client
        .create_repay_fees_instruction(&address)
        .await
    {
        Ok(instruction) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
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
        }))),
        Err(e) => {
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(e.to_string()))
        }
    }
}

/// Подтвердить погашение долгов
pub async fn confirm_fees_repaid(
    pool: web::Data<PgPool>,
    req: web::Json<crate::models::ConfirmDepositRequest>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".into(),
            ))
        }
    };

    match crate::db::mark_fees_as_repaid(&pool, address, req.amount).await {
        Ok(_) => {
            tracing::info!(
                "Fees marked as repaid for address: {}, amount: {}",
                address,
                req.amount
            );
            HttpResponse::Ok().json(ApiResponse::success("Fees marked as repaid"))
        }
        Err(e) => {
            tracing::error!("Failed to mark fees as repaid: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                "Failed to update fee status".into(),
            ))
        }
    }
}

/// Подтвердить выполненные комиссии клиринга
pub async fn confirm_clearing_fees_collected(
    pool: web::Data<PgPool>,
    req: web::Json<serde_json::Value>,
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
    if let Err(resp) = require_auth(&pool, admin_address, "confirm_clearing_fees").await {
        return resp;
    }

    let session_id = match req.get("session_id") {
        Some(serde_json::Value::Number(id)) => id.as_i64().unwrap_or(0) as i32,
        _ => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "session_id required".to_string(),
            ))
        }
    };

    let fee_signatures = match req.get("fee_signatures") {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "fee_signatures required".to_string(),
            ))
        }
    };

    // Обновляем settlements с tx_signature
    for signature_data in fee_signatures {
        if let (Some(settlement_id), Some(signature)) = (
            signature_data.get("settlement_id").and_then(|v| v.as_i64()),
            signature_data.get("signature").and_then(|v| v.as_str()),
        ) {
            let settlement_id_i32 = settlement_id as i32;
            match sqlx::query!(
                "UPDATE settlements SET tx_signature = $1 WHERE id = $2",
                signature,
                settlement_id_i32
            )
            .execute(pool.get_ref())
            .await
            {
                Ok(_) => tracing::info!(
                    "Updated settlement {} with signature {}",
                    settlement_id_i32,
                    signature
                ),
                Err(e) => {
                    tracing::error!("Failed to update settlement {}: {}", settlement_id_i32, e)
                }
            }
        }
    }

    // Обновляем статус сессии клиринга
    match sqlx::query!(
        "UPDATE netting_sessions SET status = 'settled' WHERE id = $1",
        session_id
    )
    .execute(pool.get_ref())
    .await
    {
        Ok(_) => {
            tracing::info!("Clearing session {} marked as settled", session_id);
            HttpResponse::Ok().json(ApiResponse::success(
                "Clearing fees confirmed and session settled",
            ))
        }
        Err(e) => {
            tracing::error!("Failed to update clearing session {}: {}", session_id, e);
            HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                "Failed to update clearing session".into(),
            ))
        }
    }
}

/// Получить баланс escrow (для администраторов)
pub async fn get_escrow_balance(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<crate::blockchain::BlockchainClient>>,
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
    if let Err(resp) = require_auth(&pool, admin_address, "get_escrow_balance").await {
        return resp;
    }

    // Получаем баланс escrow из блокчейна
    let (total_locked, system_fees_collected) = match blockchain_client.get_escrow_balance().await {
        Ok(balance) => balance,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(
                format!("Failed to get escrow balance: {}", e),
            ));
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(EscrowBalanceResponse {
        total_locked,
        system_fees_collected,
    }))
}
