use crate::{auth_service::verify, blockchain::BlockchainClient, models::*};
use actix_web::{web, HttpResponse, Responder};
use anchor_lang::{prelude, AccountDeserialize};
use clearing_solana::Obligation;
use solana_sdk::pubkey::Pubkey;

/// Collects confirmed obligations from on-chain program
/// Returns vec of obligations Pubkey
async fn collect_obligations_pda(
    client: &BlockchainClient,
) -> Result<Vec<Pubkey>, Box<dyn std::error::Error>> {
    let pools = client.get_obligation_pool_accounts().await?;

    let mut obligations_pda = Vec::new();

    for (_, pool) in pools {
        for (has_value, obligation) in pool.occupied.iter().zip(pool.obligations.iter()) {
            if *has_value {
                obligations_pda.push(Pubkey::new_from_array(*obligation.as_array()));
            }
        }
    }

    Ok(obligations_pda)
}

/// Collects accounts of obligations
async fn collect_obligations(
    client: &BlockchainClient,
    obligations_pda: &[Pubkey],
) -> Result<Vec<Obligation>, Box<dyn std::error::Error>> {
    let accounts = client.client.get_multiple_accounts(obligations_pda).await?;

    let mut obligations = Vec::new();

    for account in accounts.iter() {
        if let Some(account_data) = account {
            let mut obligation_account_raw_data: &[u8] = &account_data.data;
            let obligation = Obligation::try_deserialize(&mut obligation_account_raw_data)?;

            obligations.push(obligation);
        }
    }

    Ok(obligations)
}

pub async fn multi_party_clearing(
    client: web::Data<BlockchainClient>,
    admin_pubkey: web::Data<String>,
    payload: web::Json<AdminSignedRequest>,
) -> impl Responder {
    if !verify(&admin_pubkey, &payload.message, &payload.signature) {
        return HttpResponse::Unauthorized().json(ApiResponse::<String>::error(
            "Invalid admin signature".into(),
        ));
    }

    use std::collections::HashMap;

    let obligations_pda = match collect_obligations_pda(&client).await {
        Ok(pdas) => pdas,
        Err(e) => return HttpResponse::from_error(e),
    };

    let obligations = match collect_obligations(&client, &obligations_pda).await {
        Ok(obligations) => obligations,
        Err(e) => return HttpResponse::from_error(e),
    };

    // 2. Считаем net-сальдо
    let mut net: HashMap<prelude::Pubkey, i128> = HashMap::new();
    for p in &obligations {
        *net.entry(p.from.clone()).or_insert(0) -= p.amount as i128;
        *net.entry(p.to.clone()).or_insert(0) += p.amount as i128;
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

pub async fn health() -> impl Responder {
    HttpResponse::Ok().json(ApiResponse::success("API is healthy"))
}
