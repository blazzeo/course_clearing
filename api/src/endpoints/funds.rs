use crate::auth_service::require_auth;
use crate::models::{
    ApiResponse, UpdateBalanceDepositRequest, UpdateBalanceWithdrawalRequest, Withdrawal,
    WithdrawalParticipant,
};
use actix_web::{web, HttpResponse, Responder};
use serde::Serialize;
use sqlx::PgPool;
use std::str::FromStr;

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
            .json(ApiResponse::<Vec<BalancesOutput>>::error(e.to_string())),
    }
}

/// Получение всех запросов на вывод (только администратор)
pub async fn get_all_withdrawals(
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
    if let Err(resp) = require_auth(pool.get_ref(), admin_address, "view_withdrawals").await {
        return resp;
    }

    let withdrawals = sqlx::query_as!(
        Withdrawal,
        r#"
        SELECT id, participant, amount, status, requested_at, approved_at, completed_at, tx_signature, nonce, pda
        FROM withdrawals
        ORDER BY requested_at DESC
        "#,
    )
    .fetch_all(pool.get_ref())
    .await;

    match withdrawals {
        Ok(withdrawals) => HttpResponse::Ok().json(ApiResponse::success(withdrawals)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<Vec<Withdrawal>>::error(e.to_string())),
    }
}

/// Получение всех запросов на вывод
pub async fn get_withdrawals(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let participant_address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    // Проверяем права пользователя
    if let Err(resp) = require_auth(pool.get_ref(), participant_address, "view_withdrawals").await {
        return resp;
    }

    let withdrawals = sqlx::query_as!(
        WithdrawalParticipant,
        r#"
        SELECT id, amount, status, nonce, requested_at
        FROM withdrawals
        WHERE participant = $1
        ORDER BY requested_at DESC
        "#,
        participant_address
    )
    .fetch_all(pool.get_ref())
    .await;

    match withdrawals {
        Ok(withdrawals) => HttpResponse::Ok().json(ApiResponse::success(withdrawals)),
        Err(e) => HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<WithdrawalParticipant>>::error(e.to_string()),
        ),
    }
}

/// Удаление запроса на вывод
pub async fn delete_withdrawal(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let participant_address = match query.get("address") {
        Some(addr) => addr,
        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "address parameter required".to_string(),
            ))
        }
    };

    let withdrawal_id: i32 = match query.get("id") {
        Some(id) => match i32::from_str(id) {
            Ok(id) => id,
            Err(_) => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "id parameter is invalid".to_string(),
                ))
            }
        },

        None => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "id parameter required".to_string(),
            ))
        }
    };

    match sqlx::query!(
        r#"
        DELETE FROM withdrawals
        WHERE id = $1
        AND participant = $2
        AND status = 'pending'
        "#,
        withdrawal_id,
        participant_address
    )
    .execute(pool.get_ref())
    .await
    {
        Ok(_) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::InternalServerError().json(
            ApiResponse::<Vec<WithdrawalParticipant>>::error(e.to_string()),
        ),
    }
}

/// Обновление баланса при депозите (после успешной транзакции)
pub async fn update_balance_deposit(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateBalanceDepositRequest>,
) -> impl Responder {
    // Проверяем, что участник существует и активен
    let participant_exists = sqlx::query!(
        "SELECT address FROM participants WHERE address = $1 AND is_active = true",
        req.participant_address
    )
    .fetch_optional(pool.get_ref())
    .await;

    match participant_exists {
        Ok(Some(_)) => {}
        Ok(None) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Participant not found or inactive".to_string(),
            ))
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Database error: {}",
                e
            )))
        }
    }

    // Обновляем баланс (увеличиваем)
    match sqlx::query!(
        "UPDATE participants SET balance = balance + $1, updated_at = NOW() WHERE address = $2",
        req.amount_lamports,
        req.participant_address
    )
    .execute(pool.get_ref())
    .await
    {
        Ok(_) => {}
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to update balance: {}",
                e
            )))
        }
    }

    // Логируем действие
    if let Err(e) = crate::endpoints::log::log_audit_action(
        pool.get_ref(),
        &req.participant_address,
        "deposit",
        "participants",
        Some(&req.participant_address),
        None,
        Some(serde_json::json!({
            "amount_lamports": req.amount_lamports,
            "tx_signature": req.tx_signature
        })),
    )
    .await
    {
        eprintln!("Failed to log audit action: {}", e);
    }

    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
        "message": "Balance updated successfully",
        "amount_added": req.amount_lamports,
        "tx_signature": req.tx_signature
    })))
}

/// Обновление баланса при выводе средств (после успешной транзакции)
pub async fn update_balance_withdrawal(
    pool: web::Data<PgPool>,
    req: web::Json<UpdateBalanceWithdrawalRequest>,
) -> impl Responder {
    // Проверяем, что участник существует и активен
    let participant_exists = sqlx::query!(
        "SELECT address, balance FROM participants WHERE address = $1 AND is_active = true",
        req.participant_address
    )
    .fetch_optional(pool.get_ref())
    .await;

    let current_balance = match participant_exists {
        Ok(Some(row)) => match row.balance {
            Some(balance) => balance,
            None => {
                return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                    "Participant not found or inactive".to_string(),
                ))
            }
        },
        Ok(None) => {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(
                "Participant not found or inactive".to_string(),
            ))
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Database error: {}",
                e
            )))
        }
    };

    // Проверяем, что баланс достаточный
    if current_balance < req.amount_lamports {
        return HttpResponse::BadRequest().json(ApiResponse::<String>::error(format!(
            "Insufficient balance. Current: {:?}, Required: {:?}",
            current_balance, req.amount_lamports
        )));
    }

    // Обновляем баланс (уменьшаем)
    match sqlx::query!(
        "UPDATE participants SET balance = balance - $1, updated_at = NOW() WHERE address = $2",
        req.amount_lamports,
        req.participant_address
    )
    .execute(pool.get_ref())
    .await
    {
        Ok(_) => {}
        Err(e) => {
            return HttpResponse::InternalServerError().json(ApiResponse::<String>::error(format!(
                "Failed to update balance: {}",
                e
            )))
        }
    }

    // Логируем действие
    if let Err(e) = crate::endpoints::log::log_audit_action(
        pool.get_ref(),
        &req.participant_address,
        "withdrawal",
        "participants",
        Some(&req.participant_address),
        Some(serde_json::json!({
            "balance": current_balance
        })),
        Some(serde_json::json!({
            "balance": current_balance - req.amount_lamports,
            "amount_lamports": req.amount_lamports,
            "tx_signature": req.tx_signature
        })),
    )
    .await
    {
        eprintln!("Failed to log audit action: {}", e);
    }

    HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({
        "message": "Balance updated successfully",
        "amount_deducted": req.amount_lamports,
        "tx_signature": req.tx_signature,
        "new_balance": current_balance - req.amount_lamports
    })))
}
