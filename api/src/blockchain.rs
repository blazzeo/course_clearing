use anchor_lang::InstructionData;
use anyhow::{anyhow, Result};
use clearing_service::instruction::DepositFunds;
use solana_client::{nonblocking::rpc_client::RpcClient, rpc_config::CommitmentConfig};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use std::str::FromStr;

// Program ID смарт-контракта
const PROGRAM_ID: &str = "7g1DKsrECqRs2Ecy1zRvNyUwQocLJ2VAY8C8xZ7D9bVE";
const SYSTEM_PROGRAM_ID: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");

pub struct BlockchainClient {
    client: RpcClient,
    program_id: Pubkey,
}

impl BlockchainClient {
    pub fn new(rpc_url: &str) -> Result<Self> {
        let client =
            RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
        let program_id = Pubkey::from_str(PROGRAM_ID)?;

        Ok(Self { client, program_id })
    }

    /// Получить PDA для участника
    pub async fn get_participant_pda(&self, authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"participant", authority.as_ref()], &self.program_id)
    }

    /// Получить PDA для escrow
    pub async fn get_escrow_pda(&self) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"escrow"], &self.program_id)
    }

    /// Получить PDA для withdrawal
    pub async fn get_withdrawal_pda(&self, authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"withdrawal", authority.as_ref()], &self.program_id)
    }

    /// Создать инструкцию для депозита средств
    pub async fn create_deposit_instruction(
        &self,
        authority: &Pubkey,
        amount: u64,
    ) -> Result<Instruction> {
        let (participant_pda, _participant_bump) = self.get_participant_pda(authority).await;
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda().await;

        let data = DepositFunds { amount }.data();

        let accounts = vec![
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data,
        })
    }

    /// Создать инструкцию для запроса вывода средств
    pub async fn create_request_withdrawal_instruction(
        &self,
        authority: &Pubkey,
        amount: u64,
    ) -> Result<Instruction> {
        let (participant_pda, _participant_bump) = self.get_participant_pda(authority).await;
        let (withdrawal_pda, _withdrawal_bump) = self.get_withdrawal_pda(authority).await;

        let data = DepositFunds { amount }.data();

        let accounts = vec![
            AccountMeta::new_readonly(participant_pda, false),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data,
        })
    }

    /// Создать инструкцию для одобрения вывода (только администратор)
    pub async fn create_approve_withdrawal_instruction(
        &self,
        withdrawal_authority: &Pubkey,
        admin_authority: &Pubkey,
    ) -> Result<Instruction> {
        let (withdrawal_pda, _withdrawal_bump) =
            self.get_withdrawal_pda(withdrawal_authority).await;
        let (participant_pda, _participant_bump) =
            self.get_participant_pda(withdrawal_authority).await;
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda().await;

        let instruction_data = vec![3]; // approve_withdrawal instruction index

        let accounts = vec![
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(*admin_authority, true),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        })
    }

    /// Проверить баланс аккаунта
    pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        self.client
            .get_balance(pubkey)
            .await
            .map_err(|e| anyhow!(e))
    }

    /// Получить баланс участника из смарт-контракта
    pub async fn get_participant_balance(&self, authority: &Pubkey) -> Result<Option<i64>> {
        let (participant_pda, _) = self.get_participant_pda(authority).await;

        match self.client.get_account(&participant_pda).await {
            Ok(account) => {
                // Anchor аккаунты начинаются с 8-байтового discriminator'а
                // Participant: authority (32) + balance (8) + bump (1) = 41 байт данных
                if account.data.len() < 8 + 32 + 8 + 1 {
                    return Ok(None);
                }

                // Пропускаем discriminator (первые 8 байт)
                let data = &account.data[8..];
                let balance_bytes = &data[32..40]; // balance находится после authority (32 байта)
                let balance = i64::from_le_bytes(balance_bytes.try_into().unwrap());

                Ok(Some(balance))
            }
            Err(_) => Ok(None), // Аккаунт не найден или не инициализирован
        }
    }
}
