use anchor_lang::{AccountDeserialize, Discriminator};
use anyhow::Result;
use clearing_solana::{ObligationPool, ID as PROGRAM_ID};
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{CommitmentConfig, RpcAccountInfoConfig, UiAccountEncoding},
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_program::pubkey::Pubkey;

// Program ID смарт-контракта
// const SYSTEM_PROGRAM_ID: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");

pub struct BlockchainClient {
    pub client: RpcClient,
    pub program_id: Pubkey,
}

impl BlockchainClient {
    pub fn new(rpc_url: &str) -> Result<Self> {
        let client =
            RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
        let program_id: Pubkey = Pubkey::new_from_array(PROGRAM_ID.as_array().to_owned());

        Ok(Self { client, program_id })
    }

    // /// Получить PDA для участника
    // pub async fn get_participant_pda(&self, authority: &Pubkey) -> (Pubkey, u8) {
    //     Pubkey::find_program_address(&[b"participant", authority.as_ref()], &self.program_id)
    // }
    //
    // /// Get pool PDA
    // pub async fn get_obligation_pool_pda(&self, pool_id: u32) -> (Pubkey, u8) {
    //     Pubkey::find_program_address(&[b"pool", &pool_id.to_le_bytes()], &self.program_id)
    // }

    /// Collects all obligation pool accounts
    pub async fn get_obligation_pool_accounts(
        &self,
    ) -> Result<Vec<(Pubkey, ObligationPool)>, Box<dyn std::error::Error>> {
        let accounts = self
            .client
            .get_program_ui_accounts_with_config(
                &self.program_id,
                solana_client::rpc_config::RpcProgramAccountsConfig {
                    filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                        0,
                        ObligationPool::DISCRIMINATOR.to_vec(),
                    ))]),
                    account_config: RpcAccountInfoConfig {
                        encoding: Some(UiAccountEncoding::Base64),
                        ..Default::default()
                    },
                    with_context: None,
                    sort_results: None,
                },
            )
            .await?;

        let mut pools = Vec::with_capacity(accounts.len());

        for (pubkey, account) in accounts {
            let mut data: &[u8] = &account.data.decode().unwrap();
            let pool = ObligationPool::try_deserialize(&mut data)?;
            pools.push((pubkey, pool));
        }

        Ok(pools)
    }

    // /// Get pool data
    // pub async fn get_obligation_pool_data(
    //     &self,
    //     pda: &Pubkey,
    // ) -> Result<ObligationPool, Box<dyn std::error::Error>> {
    //     let account = self.client.get_account(pda).await?;
    //
    //     let expected_disc = ObligationPool::DISCRIMINATOR;
    //     let actual_disc = &account.data()[0..8];
    //
    //     if expected_disc != actual_disc {
    //         return Err("Wrong account type".into());
    //     }
    //
    //     let obligation_pool = ObligationPool::try_deserialize(&mut account.data())?;
    //
    //     Ok(obligation_pool)
    // }

    // /// Проверить, инициализирован ли участник в смарт-контракте
    // pub async fn is_participant_initialized(&self, authority: &Pubkey) -> Result<bool> {
    //     let (participant_pda, _) = self.get_participant_pda(authority).await;
    //
    //     match self.client.get_account(&participant_pda).await {
    //         Ok(_) => Ok(true),   // Аккаунт существует
    //         Err(_) => Ok(false), // Аккаунт не найден
    //     }
    // }
    //
    // /// Проверить баланс аккаунта
    // pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
    //     self.client
    //         .get_balance(pubkey)
    //         .await
    //         .map_err(|e| anyhow!(e))
    // }
}
