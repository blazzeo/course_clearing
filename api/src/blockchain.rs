// use crate::models::*;
use anyhow::{anyhow, Result};
use solana_client::{rpc_client::RpcClient, rpc_config::CommitmentConfig};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use std::str::FromStr;

// Program ID смарт-контракта
const PROGRAM_ID: &str = "F5SAzmDPvx8EBDGeU1Qrvst37TqTQEYwYgSgByKwDqK8";
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
    pub fn get_participant_pda(&self, authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"participant", authority.as_ref()], &self.program_id)
    }

    /// Получить PDA для escrow
    pub fn get_escrow_pda(&self) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"escrow"], &self.program_id)
    }

    /// Получить PDA для withdrawal
    pub fn get_withdrawal_pda(&self, authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"withdrawal", authority.as_ref()], &self.program_id)
    }

    /// Создать инструкцию для депозита средств
    pub fn create_deposit_instruction(
        &self,
        authority: &Pubkey,
        amount: u64,
    ) -> Result<Instruction> {
        let (participant_pda, _participant_bump) = self.get_participant_pda(authority);
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda();

        let instruction_data = [
            vec![0], // deposit_funds instruction index
            amount.to_le_bytes().to_vec(),
        ]
        .concat();

        let accounts = vec![
            AccountMeta::new(participant_pda, false),
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        })
    }

    /// Создать инструкцию для запроса вывода средств
    pub fn create_request_withdrawal_instruction(
        &self,
        authority: &Pubkey,
        amount: u64,
    ) -> Result<Instruction> {
        let (participant_pda, _participant_bump) = self.get_participant_pda(authority);
        let (withdrawal_pda, _withdrawal_bump) = self.get_withdrawal_pda(authority);

        let instruction_data = [
            vec![1], // request_withdrawal instruction index
            amount.to_le_bytes().to_vec(),
        ]
        .concat();

        let accounts = vec![
            AccountMeta::new_readonly(participant_pda, false),
            AccountMeta::new(withdrawal_pda, false),
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        })
    }

    /// Создать инструкцию для одобрения вывода (только администратор)
    pub fn create_approve_withdrawal_instruction(
        &self,
        withdrawal_authority: &Pubkey,
        admin_authority: &Pubkey,
    ) -> Result<Instruction> {
        let (withdrawal_pda, _withdrawal_bump) = self.get_withdrawal_pda(withdrawal_authority);
        let (participant_pda, _participant_bump) = self.get_participant_pda(withdrawal_authority);
        let (escrow_pda, _escrow_bump) = self.get_escrow_pda();

        let instruction_data = vec![2]; // approve_withdrawal instruction index

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

    /// Создать инструкцию для финализации расчета клиринга
    pub fn create_finalize_settlement_instruction(
        &self,
        from_address: &Pubkey,
        to_address: &Pubkey,
        amount: u64,
        admin_authority: &Pubkey,
        settlement_id: u64,
    ) -> Result<Instruction> {
        let (participant_from_pda, _from_bump) = self.get_participant_pda(from_address);
        let (participant_to_pda, _to_bump) = self.get_participant_pda(to_address);

        let instruction_data = [
            vec![3], // finalize_clearing_settlement instruction index
            settlement_id.to_le_bytes().to_vec(),
            from_address.to_bytes().to_vec(),
            to_address.to_bytes().to_vec(),
            amount.to_le_bytes().to_vec(),
        ]
        .concat();

        let accounts = vec![
            AccountMeta::new(participant_from_pda, false),
            AccountMeta::new(participant_to_pda, false),
            AccountMeta::new_readonly(*admin_authority, true),
        ];

        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: instruction_data,
        })
    }

    // /// Отправить транзакцию в блокчейн
    // pub async fn send_transaction(
    //     &self,
    //     instructions: Vec<Instruction>,
    //     signers: Vec<&Keypair>,
    // ) -> Result<String> {
    //     let recent_blockhash = self.client.get_latest_blockhash()?;
    //     let mut transaction = Transaction::new_unsigned(solana_sdk::message::Message::new(
    //         &instructions,
    //         Some(&signers[0].pubkey()),
    //     ));
    //     transaction.sign(&signers, recent_blockhash);
    //
    //     let signature = self.client.send_and_confirm_transaction(&transaction)?;
    //     Ok(signature.to_string())
    // }

    /// Проверить баланс аккаунта
    pub fn get_balance(&self, pubkey: &Pubkey) -> Result<u64> {
        self.client.get_balance(pubkey).map_err(|e| anyhow!(e))
    }
}
