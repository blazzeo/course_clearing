use anchor_lang::{AccountDeserialize, AnchorDeserialize, Discriminator};
use base64::{engine::general_purpose, Engine as _};
use clearing_solana::{
    ObligationCancelled, ObligationConfirmed, ObligationCreated, ObligationDeclined,
    ObligationNetted, ObligationPartiallyNetted, Participant as OnchainParticipant,
    ParticipantRegistered, ID as PROGRAM_ID,
};
use solana_client::{
    nonblocking::pubsub_client::PubsubClient,
    nonblocking::rpc_client::RpcClient,
    rpc_config::{CommitmentConfig, RpcTransactionLogsConfig, RpcTransactionLogsFilter},
};
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;
use tokio::time::{sleep, Duration};
use tokio_stream::StreamExt;

enum IndexedEvent {
    ParticipantRegistered(ParticipantRegistered),
    ObligationCreated(ObligationCreated),
    ObligationConfirmed(ObligationConfirmed),
    ObligationDeclined(ObligationDeclined),
    ObligationCancelled(ObligationCancelled),
    ObligationNetted(ObligationNetted),
    ObligationPartiallyNetted(ObligationPartiallyNetted),
}

fn extract_program_data(line: &str) -> Option<&str> {
    line.strip_prefix("Program data: ").map(str::trim)
}

fn decode_event_payload(data: &[u8]) -> Option<IndexedEvent> {
    fn decode<T: AnchorDeserialize + Discriminator>(bytes: &[u8]) -> Option<T> {
        if bytes.len() < 8 || &bytes[..8] != T::DISCRIMINATOR {
            return None;
        }
        T::try_from_slice(&bytes[8..]).ok()
    }

    if let Some(e) = decode::<ParticipantRegistered>(data) {
        return Some(IndexedEvent::ParticipantRegistered(e));
    }
    if let Some(e) = decode::<ObligationCreated>(data) {
        return Some(IndexedEvent::ObligationCreated(e));
    }
    if let Some(e) = decode::<ObligationConfirmed>(data) {
        return Some(IndexedEvent::ObligationConfirmed(e));
    }
    if let Some(e) = decode::<ObligationDeclined>(data) {
        return Some(IndexedEvent::ObligationDeclined(e));
    }
    if let Some(e) = decode::<ObligationCancelled>(data) {
        return Some(IndexedEvent::ObligationCancelled(e));
    }
    if let Some(e) = decode::<ObligationNetted>(data) {
        return Some(IndexedEvent::ObligationNetted(e));
    }
    if let Some(e) = decode::<ObligationPartiallyNetted>(data) {
        return Some(IndexedEvent::ObligationPartiallyNetted(e));
    }
    None
}

fn parse_events(logs: &[String]) -> Vec<IndexedEvent> {
    logs.iter()
        .filter_map(|line| extract_program_data(line))
        .filter_map(|encoded| general_purpose::STANDARD.decode(encoded).ok())
        .filter_map(|bytes| decode_event_payload(&bytes))
        .collect()
}

async fn fetch_participant_account(
    rpc_client: &RpcClient,
    participant_pda: &str,
) -> anyhow::Result<OnchainParticipant> {
    let pubkey: Pubkey = participant_pda.parse()?;
    let mut last_error = None;

    for _ in 0..30 {
        match rpc_client.get_account_data(&pubkey).await {
            Ok(data) => {
                let mut slice: &[u8] = &data;
                return Ok(OnchainParticipant::try_deserialize(&mut slice)?);
            }
            Err(err) => {
                last_error = Some(err);
                sleep(Duration::from_secs(1)).await;
            }
        }
    }

    Err(last_error
        .map(anyhow::Error::from)
        .unwrap_or_else(|| anyhow::anyhow!("participant account unavailable after retries")))
}

async fn persist_event(
    pool: &PgPool,
    rpc_client: &RpcClient,
    signature: &str,
    event: IndexedEvent,
) -> anyhow::Result<()> {
    match event {
        IndexedEvent::ParticipantRegistered(e) => {
            let participant_pda = e.participant.to_string();
            sqlx::query(
                r#"
                INSERT INTO events (tx_signature, event_type, data, created_at)
                VALUES ($1, 'participant_registered', jsonb_build_object('participant', $2), $3)
                ON CONFLICT (tx_signature) DO NOTHING
                "#,
            )
            .bind(signature)
            .bind(&participant_pda)
            .bind(e.timestamp)
            .execute(pool)
            .await?;

            match fetch_participant_account(rpc_client, &participant_pda).await {
                Ok(participant) => {
                    sqlx::query(
                        r#"
                        INSERT INTO participants (pda, authority, user_name)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (pda) DO UPDATE SET
                            authority = EXCLUDED.authority,
                            user_name = EXCLUDED.user_name
                        "#,
                    )
                    .bind(&participant_pda)
                    .bind(participant.authority.to_string())
                    .bind(participant.name)
                    .execute(pool)
                    .await?;
                }
                Err(err) => {
                    tracing::warn!(
                        "ParticipantRegistered observed but participant account still unavailable: pda={}, err={err:?}",
                        participant_pda
                    );
                }
            }
        }
        IndexedEvent::ObligationCreated(e) => {
            sqlx::query(
                r#"
                INSERT INTO obligations (pda, from_address, to_address, original_amount, remaining_amount, status, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $4, 'created', $5, $5)
                ON CONFLICT (pda) DO UPDATE SET
                    from_address = EXCLUDED.from_address,
                    to_address = EXCLUDED.to_address,
                    original_amount = EXCLUDED.original_amount,
                    remaining_amount = EXCLUDED.remaining_amount,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                "#,
            )
            .bind(e.obligation.to_string())
            .bind(e.from.to_string())
            .bind(e.to.to_string())
            .bind(i64::try_from(e.amount).unwrap_or(i64::MAX))
            .bind(e.timestamp)
            .execute(pool)
            .await?;

            sqlx::query(
                r#"
                INSERT INTO events (tx_signature, event_type, data, created_at)
                VALUES ($1, 'obligation_created',
                    jsonb_build_object('obligation', $2, 'from', $3, 'to', $4, 'amount', $5), $6)
                ON CONFLICT (tx_signature) DO NOTHING
                "#,
            )
            .bind(signature)
            .bind(e.obligation.to_string())
            .bind(e.from.to_string())
            .bind(e.to.to_string())
            .bind(i64::try_from(e.amount).unwrap_or(i64::MAX))
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
        IndexedEvent::ObligationConfirmed(e) => {
            sqlx::query(
                "UPDATE obligations SET status = 'confirmed', updated_at = $2 WHERE pda = $1",
            )
            .bind(e.obligation.to_string())
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
        IndexedEvent::ObligationDeclined(e) => {
            sqlx::query(
                "UPDATE obligations SET status = 'declined', closed_at = $2, updated_at = $2 WHERE pda = $1",
            )
            .bind(e.obligation.to_string())
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
        IndexedEvent::ObligationCancelled(e) => {
            sqlx::query(
                "UPDATE obligations SET status = 'cancelled', closed_at = $2, updated_at = $2 WHERE pda = $1",
            )
            .bind(e.obligation.to_string())
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
        IndexedEvent::ObligationNetted(e) => {
            sqlx::query(
                "UPDATE obligations SET status = 'netted', remaining_amount = 0, closed_at = $2, updated_at = $2 WHERE pda = $1",
            )
            .bind(e.obligation.to_string())
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
        IndexedEvent::ObligationPartiallyNetted(e) => {
            let rem = i64::try_from(e.remaining_amount).unwrap_or(i64::MAX);
            sqlx::query(
                "UPDATE obligations SET status = 'partially_netted', remaining_amount = $2, updated_at = $3 WHERE pda = $1",
            )
            .bind(e.obligation.to_string())
            .bind(rem)
            .bind(e.timestamp)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

pub async fn index_loop(ws_url: String, rpc_url: String, pool: PgPool) -> anyhow::Result<()> {
    let rpc_client = RpcClient::new(rpc_url);
    loop {
        let pubsub_client = match PubsubClient::new(&ws_url).await {
            Ok(c) => c,
            Err(err) => {
                tracing::error!("Indexer ws connect failed: {err:?}");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        let subscribe = PubsubClient::logs_subscribe(
            &pubsub_client,
            RpcTransactionLogsFilter::Mentions(vec![PROGRAM_ID.to_string()]),
            RpcTransactionLogsConfig {
                commitment: Some(CommitmentConfig::confirmed()),
            },
        )
        .await;

        let (mut stream, _unsubscribe) = match subscribe {
            Ok(v) => v,
            Err(err) => {
                tracing::error!("Indexer subscribe failed: {err:?}");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        tracing::info!("Indexer subscribed to program logs");

        while let Some(msg) = stream.next().await {
            if msg.value.err.is_some() {
                continue;
            }
            let signature = msg.value.signature.clone();
            let events = parse_events(&msg.value.logs);
            for event in events {
                if let Err(err) = persist_event(&pool, &rpc_client, &signature, event).await {
                    tracing::error!("Indexer persist failed for {signature}: {err:?}");
                }
            }
        }

        tracing::warn!("Indexer stream ended, reconnecting");
        sleep(Duration::from_secs(1)).await;
    }
}
