use std::sync::Arc;

use crate::{blockchain::BlockchainClient, models::*};
use actix_web::{web, HttpResponse, Responder};

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}

/// Collects confirmed positions from on-chain program
async fn collect_positins(client: BlockchainClient) -> Result<Vec<([u8; 32], i64)>, &'static str> {
    Ok(vec![])
}

pub async fn multi_party_clearing(client: web::Data<Arc<BlockchainClient>>) -> impl Responder {
    use std::collections::HashMap;

    // 1. Берём подтверждённые позиции
    let positions = match collect_positins(&client).await {
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

    // Возвращаем settlements с дополнительной информацией для финализации в блокчейне
    let response = serde_json::json!({
        "settlements": settlements,
        "message": "Clearing calculated. Use settlement records to finalize on blockchain if needed."
    });

    HttpResponse::Ok().json(ApiResponse::success(response))
}
