use super::log::log_audit_action;
use crate::blockchain::BlockchainClient;
use crate::db::collect_confirmed_positions;
use crate::models::{ApiResponse, Position};
use actix_web::{web, HttpResponse, Responder};
use serde_json;
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;

pub async fn multi_party_clearing(
    pool: web::Data<PgPool>,
    blockchain_client: web::Data<Arc<BlockchainClient>>,
) -> impl Responder {
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

    // 2.5. Проверяем, что все участники не заблокированы
    for participant_addr in &participants {
        let is_blocked = blockchain_client
            .is_participant_blocked(
                &solana_sdk::pubkey::Pubkey::from_str(participant_addr).unwrap(),
            )
            .await
            .unwrap_or(false);

        if is_blocked {
            return HttpResponse::BadRequest().json(ApiResponse::<String>::error(format!(
                "Participant {} is blocked due to outstanding fees",
                participant_addr
            )));
        }
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

    // 7. Получаем настройки комиссий
    let clearing_fee_rate = match crate::db::get_system_setting_value(&pool, "clearing_fee").await {
        Ok(Some(value)) => value as f32,
        _ => 0.001, // значение по умолчанию
    };

    // 8. Записываем settlements без tx_signature и создаем инструкции комиссий
    let mut settlement_records = Vec::new();
    let mut fee_instructions = Vec::new();

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

        // Создаем инструкцию для взимания комиссии
        let fee_amount = (s.amount as f64 * clearing_fee_rate as f64) as u64;
        if fee_amount > 0 {
            let from_pubkey = solana_sdk::pubkey::Pubkey::from_str(&s.from_address).unwrap();

            tracing::info!(
                "Creating fee collection instruction: settlement_id={}, from={}, amount={}, fee_amount={}",
                settlement_id,
                s.from_address,
                s.amount,
                fee_amount
            );

            let fee_ix = blockchain_client
                .create_collect_fee_instruction(&from_pubkey, fee_amount, "clearing".to_string())
                .await
                .unwrap();

            fee_instructions.push(serde_json::json!({
                "settlement_id": settlement_id,
                "from_address": s.from_address,
                "fee_amount": fee_amount,
                "instruction": fee_ix
            }));

            // // Создаем запись о потенциальном долге
            // create_outstanding_fee(
            //     &pool,
            //     &s.from_address,
            //     fee_amount as i64,
            //     "clearing",
            //     Some(session_id),
            //     Some(settlement_id),
            // )
            // .await
            // .unwrap();
        }
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
        "fee_instructions": fee_instructions,
        "session_id": session_id,
        "clearing_fee_rate": clearing_fee_rate,
        "message": "Clearing calculated in database. Use settlement records and fee instructions to finalize on blockchain."
    });

    HttpResponse::Ok().json(ApiResponse::success(response))
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
