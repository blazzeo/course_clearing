// use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::nonblocking::rpc_client::RpcClient;
use sqlx::PgPool;

fn parse_event(logs: &[String]) -> Option<MyEvent> {
    for line in logs {
        if line.contains("Program data:") {
            let data = extract_base64(line)?;
            return MyEvent::try_from_slice(&data).ok();
        }
    }
    None
}

pub async fn index_loop(rpc: &RpcClient, pool: &PgPool) -> anyhow::Result<()> {
    let (mut client, receiver) = PubsubClient::logs_subscribe(
        "wss://api.mainnet-beta.solana.com",
        RpcTransactionLogsFilter::Mentions(vec![PROGRAM_ID.to_string()]),
        RpcTransactionLogsConfig::default(),
    )
    .await?;

    while let Some(log) = receiver.next().await {
        if let Ok(event) = parse_event(&log.value.logs) {
            handle_event(&pool, event).await?;
        }
    }

    Ok(())
}
