use anchor_lang::{Discriminator, InstructionData};
use anyhow::{anyhow, Result};
use clearing_service::{
    instruction::{
        ApproveWithdrawal, DepositFunds, InitializeEscrow, InitializeParticipant, RequestWithdrawal,
    },
    Participant,
};
use solana_client::{nonblocking::rpc_client::RpcClient, rpc_config::CommitmentConfig};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use std::str::FromStr;

// Program ID смарт-контракта
const PROGRAM_ID: &str = "ARJmooR8RhUjSkYiYBYtDSpPam1khAmYorn2ckmUC9vQ";
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
        Pubkey::find_program_address(
            &[b"participant", authority.as_ref(), &[1]],
            &self.program_id,
        )
    }

    /// Получить PDA для escrow
    pub async fn get_escrow_pda(&self) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"escrow"], &self.program_id)
    }

    /// Проверить, инициализирован ли участник в смарт-контракте
    pub async fn is_participant_initialized(&self, authority: &Pubkey) -> Result<bool> {
        let (participant_pda, _) = self.get_participant_pda(authority).await;

        match self.client.get_account(&participant_pda).await {
            Ok(_) => Ok(true),   // Аккаунт существует
            Err(_) => Ok(false), // Аккаунт не найден
        }
    }

    /// Проверить, инициализирован ли escrow аккаунт
    pub async fn is_escrow_initialized(&self) -> Result<bool> {
        let (escrow_pda, _) = self.get_escrow_pda().await;

        match self.client.get_account(&escrow_pda).await {
            Ok(_) => Ok(true),   // Аккаунт существует
            Err(_) => Ok(false), // Аккаунт не найден
        }
    }

    /// Проверить, корректно ли инициализирован Participant аккаунт (с правильным discriminator'ом)
    pub async fn is_participant_valid(&self, authority: &Pubkey) -> Result<bool> {
        let (participant_pda, _) = self.get_participant_pda(authority).await;

        tracing::info!("Checking participant validity for PDA: {}", participant_pda);

        match self.client.get_account(&participant_pda).await {
            Ok(account) => {
                tracing::info!(
                    "Account exists for PDA: {}, owner: {}",
                    participant_pda,
                    account.owner
                );

                // Проверяем, что аккаунт принадлежит нашей программе
                if account.owner != self.program_id {
                    tracing::warn!(
                        "Account owner mismatch for PDA: {} (expected: {}, got: {})",
                        participant_pda,
                        self.program_id,
                        account.owner
                    );
                    return Ok(false);
                }

                // Проверяем discriminator
                let expected_discriminator = Participant::DISCRIMINATOR;
                tracing::info!(
                    "Expected discriminator: {:?}, account data length: {}",
                    expected_discriminator,
                    account.data.len()
                );

                if account.data.len() < 8 {
                    tracing::error!("Account data too short for PDA: {}", participant_pda);
                    return Ok(false);
                }

                let actual_discriminator = &account.data[0..8];
                if actual_discriminator != expected_discriminator {
                    tracing::error!(
                        "Discriminator mismatch for PDA: {} (expected: {:?}, got: {:?})",
                        participant_pda,
                        expected_discriminator,
                        actual_discriminator
                    );
                    return Ok(false);
                }

                tracing::info!(
                    "Participant validation successful for PDA: {}",
                    participant_pda
                );
                Ok(true)
            }
            Err(e) => {
                tracing::warn!(
                    "Account not found for PDA: {}, error: {}",
                    participant_pda,
                    e
                );
                Ok(false)
            }
        }
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
        amount: i64,
    ) -> Result<(Instruction, String)> {
        tracing::info!(
            "Creating withdrawal instruction for authority: {}, amount: {}",
            authority,
            amount
        );

        let (participant_pda, _participant_bump) = self.get_participant_pda(authority).await;
        tracing::info!("Participant PDA: {}", participant_pda);

        // Сначала проверяем, что Participant аккаунт корректен
        if !self.is_participant_valid(authority).await? {
            tracing::error!("Participant validation failed for authority: {}", authority);
            return Err(anyhow!("Participant account is not properly initialized"));
        }

        tracing::info!(
            "Participant validation passed, reading account data for: {}",
            participant_pda
        );

        // Читаем аккаунт participant через RPC
        let account_data = self.client.get_account_data(&participant_pda).await?;
        tracing::info!("Account data length: {}", account_data.len());

        // Используем ручной парсинг:
        if account_data.len() < 8 + 32 + 8 + 1 + 8 {
            return Err(anyhow!("Account data too short for participant"));
        }

        // Пропускаем discriminator (первые 8 байт) и authority (32 байта),
        // затем balance (8 байт), bump (1 байт), и получаем withdrawal_nonce (8 байт)
        let data = &account_data[8..]; // Пропускаем discriminator
        let nonce_offset = 32 + 8 + 1; // authority + balance + bump
        let nonce_bytes = &data[nonce_offset..nonce_offset + 8];
        let nonce = u64::from_le_bytes(
            nonce_bytes
                .try_into()
                .map_err(|_| anyhow!("Invalid nonce data"))?,
        );

        tracing::info!(
            "Participant deserialized successfully, withdrawal_nonce: {}",
            nonce
        );

        let withdrawal_pda = Pubkey::find_program_address(
            &[
                b"withdrawal",
                authority.as_ref(),
                &(nonce as u64).to_le_bytes(),
            ],
            &self.program_id,
        )
        .0;

        tracing::info!("Withdrawal PDA calculated: {}", withdrawal_pda);

        let data = RequestWithdrawal {
            amount: amount as u64,
        }
        .data();

        tracing::info!("Instruction data created, length: {}", data.len());

        let accounts = vec![
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        tracing::info!(
            "Withdrawal instruction created successfully for authority: {}",
            authority
        );

        Ok((
            Instruction {
                program_id: self.program_id,
                accounts,
                data,
            },
            withdrawal_pda.to_string(),
        ))
    }

    /// Создать инструкцию для одобрения вывода (только администратор)
    pub async fn create_approve_withdrawal_instruction(
        &self,
        withdrawal_authority: &Pubkey,
        recipient: &Pubkey,
        admin_authority: &Pubkey,
        pda: String, // withdrawal_nonce: i64,
    ) -> Result<Instruction> {
        tracing::info!(
            "Creating approve withdrawal instruction for withdrawal_authority: {}, recipient: {}, admin: {}, pda: {}",
            withdrawal_authority,
            recipient,
            admin_authority,
            pda
        );

        let withdrawal_pda = Pubkey::from_str_const(&pda);

        //     Pubkey::find_program_address(
        //     &[
        //         b"withdrawal",
        //         withdrawal_authority.as_ref(),
        //         &(withdrawal_nonce as u64).to_le_bytes(),
        //     ],
        //     &self.program_id,
        // )
        // .0;

        tracing::info!(
            "Approve withdrawal - calculated withdrawal PDA: {} (authority: {}, pda: {})",
            withdrawal_pda,
            withdrawal_authority,
            pda
        );
        let (participant_pda, _participant_bump) =
            self.get_participant_pda(withdrawal_authority).await;
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda().await;

        let data = ApproveWithdrawal {}.data();

        let accounts = vec![
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(*recipient, false), // recipient аккаунт
            AccountMeta::new_readonly(*admin_authority, true),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data,
        })
    }

    /// Проверить баланс аккаунта
    pub async fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        self.client
            .get_balance(pubkey)
            .await
            .map_err(|e| anyhow!(e))
    }

    /// Создать инструкцию для инициализации участника
    pub async fn create_initialize_participant_instruction(
        &self,
        authority: &Pubkey,
    ) -> Result<Instruction> {
        let (participant_pda, _participant_bump) = self.get_participant_pda(authority).await;

        let data = InitializeParticipant {}.data();

        let accounts = vec![
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data,
        })
    }

    /// Создать инструкцию для инициализации escrow
    pub async fn create_initialize_escrow_instruction(
        &self,
        authority: &Pubkey,
    ) -> Result<Instruction> {
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda().await;

        let data = InitializeEscrow {}.data();

        let accounts = vec![
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

    // Создание инструкции
    pub fn create_get_withdrawal_nonce_instruction(
        program_id: &Pubkey,
        participant_pda: &Pubkey,
        authority: &Pubkey,
    ) -> Instruction {
        let accounts = vec![
            AccountMeta::new_readonly(*participant_pda, false),
            AccountMeta::new_readonly(*authority, true), // signer, если нужно
        ];

        Instruction {
            program_id: *program_id,
            accounts,
            data: vec![], // Anchor сам добавит discriminator для метода
        }
    }
}
