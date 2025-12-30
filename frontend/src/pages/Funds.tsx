import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'
import { useWallet } from '@solana/wallet-adapter-react'
import { Transaction, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js"
import { RPC_URL } from '../App'

interface BlockchainBalance {
	blockchain_balance: number
	contract_balance?: number
}

interface WithdrawalRequest {
	id?: number
	amount: number
	status: string
	requested_at?: string
}

interface ParticipantStatus {
	address: string
	balance: number
	outstanding_fees: number
	is_blocked: boolean
	total_debt: number
}

export default function Funds() {
	const { publicKey, sendTransaction } = useWallet()
	const [balance, setBalance] = useState<BlockchainBalance | null>(null)
	const [loading, setLoading] = useState(true)
	const [actionLoading, setActionLoading] = useState(false)
	const [depositAmount, setDepositAmount] = useState('')
	const [withdrawalAmount, setWithdrawalAmount] = useState('')
	const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>([])
	const [participantStatus, setParticipantStatus] = useState<ParticipantStatus | null>(null)

	useEffect(() => {
		if (publicKey) {
			loadBalance()
			loadWithdrawalRequests()
			loadParticipantStatus()
		}
	}, [publicKey])

	const loadBalance = async () => {
		if (!publicKey) return

		try {
			setLoading(true)
			const response = await axios.get(`${API_URL}/api/blockchain/balance?address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setBalance(response.data.data)
			}
		} catch (error) {
			console.error('Error loading balance:', error)
			toast.error('Ошибка загрузки баланса')
		} finally {
			setLoading(false)
		}
	}

	const loadWithdrawalRequests = async () => {
		if (!publicKey) {
			toast.error('Подключите кошелек');
			return;
		}

		try {
			setLoading(true)
			const response = await axios.get(`${API_URL}/api/blockchain/withdrawals?address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setWithdrawalRequests(response.data.data)
			}
		} catch (error) {
			console.error('Error loading withdrawals:', error)
			toast.error('Ошибка загрузки запросов на вывод')
		} finally {
			setLoading(false)
		}
	}


	const loadParticipantStatus = async () => {
		if (!publicKey) return

		try {
			const response = await axios.get(`${API_URL}/api/blockchain/status?address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setParticipantStatus(response.data.data)
			}
		} catch (error) {
			console.error('Error loading participant status:', error)
		}
	}

	const deleteWithdrawalRequests = async (id: number) => {
		if (!publicKey) {
			toast.error('Подключите кошелек');
			return;
		}

		try {
			setLoading(true)

			const response = await axios.delete(
				`${API_URL}/api/blockchain/withdrawals?address=${publicKey.toBase58()}&id=${id}`
			)

			if (response.data.success) {
				toast.success('Запрос успешно удален')
			}
		} catch (error) {
			console.error('Error loading withdrawals:', error)
			toast.error('Ошибка при удалении запроса на вывод')
		} finally {
			await loadWithdrawalRequests()
			setLoading(false)
		}
	}


	const handleDeposit = async () => {
		if (!publicKey) {
			toast.error('Подключите кошелек');
			return;
		}
		const amount = parseFloat(depositAmount);
		if (!amount || amount <= 0) {
			toast.error('Введите корректную сумму');
			return;
		}
		try {
			setActionLoading(true);

			// 1. Получаем инструкцию депозита от API
			const resp = await axios.post(
				`${API_URL}/api/blockchain/deposit?address=${publicKey.toBase58()}`,
				{ amount: Math.round(amount * 1e9) }
			);
			if (!resp.data.success) throw new Error(resp.data.error || 'Ошибка депозита');
			const instructionData = resp.data.data.instruction;

			if (!Array.isArray(instructionData.data)) {
				throw new Error('Invalid instruction data format');
			}

			const ix = new TransactionInstruction({
				programId: new PublicKey(instructionData.program_id),
				keys: instructionData.accounts.map((acc: any) => ({
					pubkey: new PublicKey(acc.pubkey),
					isSigner: acc.is_signer,
					isWritable: acc.is_writable
				})),
				data: new Uint8Array(instructionData.data) as Buffer,
			});

			const connection = new Connection(RPC_URL);

			const { blockhash } = await connection.getLatestBlockhash();

			const tx = new Transaction();

			tx.feePayer = publicKey;
			tx.recentBlockhash = blockhash;

			tx.add(ix);

			// Симуляция транзакции перед отправкой
			console.log('Симуляция транзакции...')
			const simulationResult = await connection.simulateTransaction(tx)
			console.log('Результат симуляции:', simulationResult)

			if (simulationResult.value.err) {
				console.error('Ошибка симуляции:', simulationResult.value.err)
				console.error('Логи симуляции:', simulationResult.value.logs)
				toast.error(`Ошибка симуляции: ${simulationResult.value.err}`)
				return
			}

			if (simulationResult.value.logs) {
				console.log('Логи транзакции:', simulationResult.value.logs)
			}

			const sig = await sendTransaction(tx, connection);

			// Обновляем баланс после депозита
			await axios.post(`${API_URL}/api/blockchain/balance/deposit/update`, {
				participant_address: publicKey.toString(),
				amount_lamports: Math.round(parseFloat(depositAmount) * 1e9),
				tx_signature: sig
			});

			toast.success(`Транзакция отправлена! Sig: ${sig}`);
			loadBalance();
			setDepositAmount('');
		} catch (error: any) {
			console.error('Deposit error:', error);
			toast.error(error.message || 'Ошибка депозита');
		} finally {
			setActionLoading(false);
		}
	}

	const handleWithdrawalRequest = async () => {
		if (!publicKey) {
			toast.error('Подключите кошелек');
			return;
		}

		if (participantStatus?.is_blocked) {
			toast.error('Ваш аккаунт заблокирован из-за долгов по комиссиям. Погасите долги перед выводом средств.');
			return;
		}
		const amount = parseFloat(withdrawalAmount);

		if (!amount || amount <= 0) {
			toast.error('Введите корректную сумму');
			return;
		}

		try {
			setActionLoading(true);
			// 1. Получаем инструкцию вывода от API
			const resp = await axios.post(
				`${API_URL}/api/blockchain/withdraw/request?address=${publicKey.toBase58()}`,
				{ amount: Math.round(amount * 1e9) }
			);

			if (!resp.data.success) throw new Error(resp.data.error || 'Ошибка вывода');

			const instructionData = resp.data.data.instruction;
			const withdraw_pda = resp.data.data.pda;

			const ix = new TransactionInstruction({
				programId: new PublicKey(instructionData.program_id),
				keys: instructionData.accounts.map((acc: any) => ({
					pubkey: new PublicKey(acc.pubkey),
					isSigner: acc.is_signer,
					isWritable: acc.is_writable
				})),
				data: Uint8Array.from(instructionData.data) as Buffer,
			});

			const connection = new Connection(RPC_URL);
			const { blockhash } = await connection.getLatestBlockhash();

			const tx = new Transaction();

			tx.feePayer = publicKey;
			tx.recentBlockhash = blockhash;

			tx.add(ix);

			const sim = await connection.simulateTransaction(tx);
			console.log('[CLIENT] Simulation result - logs:', sim.value.logs);
			console.log('[CLIENT] Simulation result - error:', sim.value.err);

			const sig = await sendTransaction(tx, connection);

			// 2. Подтверждаем успешное выполнение и сохраняем в БД
			const confirmResp = await axios.post(
				`${API_URL}/api/blockchain/withdraw/confirm?address=${publicKey.toBase58()}`,
				{
					amount: Math.round(amount * 1e9),
					pda: withdraw_pda,
					tx_signature: sig
				}
			);

			if (!confirmResp.data.success) {
				console.error('[CLIENT] Failed to confirm withdrawal:', confirmResp.data.error);
				toast.warning('Транзакция выполнена, но не удалось сохранить в БД');
			} else {
				console.log('[CLIENT] Withdrawal confirmed in database');
			}

			toast.success(`Запрос на вывод отправлен! Sig: ${sig}`);
			loadBalance();
			loadWithdrawalRequests(); // Обновляем список запросов
			setWithdrawalAmount('');
		} catch (error: any) {
			console.error('[CLIENT] Withdrawal error:', error);
			console.error('[CLIENT] Error details:', error.response?.data || error.message);
			toast.error(error.message || 'Ошибка запроса на вывод');
		} finally {
			setActionLoading(false);
		}
	}

	if (!publicKey) {
		return <div className="card">Подключите кошелек для управления средствами</div>
	}

	return (
		<div style={{ maxWidth: '800px', margin: '0 auto' }}>
			<h1 style={{ color: 'white', marginBottom: '20px' }}>Управление средствами</h1>

			{/* Баланс */}
			<div className="card" style={{ marginBottom: '24px' }}>
				<h2 style={{ marginBottom: '16px' }}>Баланс</h2>
				{loading ? (
					<div>Загрузка...</div>
				) : balance ? (
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
						<div style={{ padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4caf50' }}>
								{(balance.blockchain_balance / 1e9).toFixed(4)} SOL
							</div>
							<div style={{ color: '#666' }}>Баланс кошелька</div>
						</div>
						<div style={{ padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2196f3' }}>
								{balance.contract_balance ? (balance.contract_balance / 1e9).toFixed(4) + ' SOL' : 'Н/Д'}
							</div>
							<div style={{ color: '#666' }}>Депозит</div>
						</div>
					</div>
				) : (
					<div>Не удалось загрузить баланс</div>
				)}
			</div>

			{/* Депозит */}
			<div className="card" style={{ marginBottom: '24px' }}>
				<h2 style={{ marginBottom: '16px' }}>Депозит средств</h2>
				<p style={{ marginBottom: '16px', color: '#666' }}>
					Переведите средства на смарт-контракт для участия в клиринге
				</p>
				<div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
					<input
						type="number"
						value={depositAmount}
						onChange={(e) => setDepositAmount(e.target.value)}
						placeholder="Сумма в SOL"
						step="0.01"
						min="0"
						style={{
							flex: 1,
							padding: '8px 12px',
							border: '1px solid #ccc',
							borderRadius: '4px'
						}}
					/>
					<button
						onClick={handleDeposit}
						disabled={actionLoading}
						style={{
							padding: '8px 16px',
							background: actionLoading ? '#ccc' : '#4caf50',
							color: 'white',
							border: 'none',
							borderRadius: '4px',
							cursor: actionLoading ? 'not-allowed' : 'pointer'
						}}
					>
						{actionLoading ? 'Обработка...' : 'Депозит'}
					</button>
				</div>
			</div>

			{/* Запрос на вывод */}
			<div className="card" style={{ marginBottom: '24px' }}>
				<h2 style={{ marginBottom: '16px' }}>Запрос на вывод средств</h2>
				<p style={{ marginBottom: '16px', color: '#666' }}>
					Создайте запрос на вывод средств. Администратор должен одобрить его.
				</p>
				<div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
					<input
						type="number"
						value={withdrawalAmount}
						onChange={(e) => setWithdrawalAmount(e.target.value)}
						placeholder="Сумма в SOL"
						step="0.01"
						min="0"
						style={{
							flex: 1,
							padding: '8px 12px',
							border: '1px solid #ccc',
							borderRadius: '4px'
						}}
					/>
					<button
						onClick={handleWithdrawalRequest}
						disabled={actionLoading}
						style={{
							padding: '8px 16px',
							background: actionLoading ? '#ccc' : '#ff9800',
							color: 'white',
							border: 'none',
							borderRadius: '4px',
							cursor: actionLoading ? 'not-allowed' : 'pointer'
						}}
					>
						{actionLoading ? 'Обработка...' : 'Запросить вывод'}
					</button>
				</div>
			</div>

			{/* Запросы на вывод */}
			<div className="card">
				<h2 style={{ marginBottom: '16px' }}>Запросы на вывод</h2>
				{withdrawalRequests.length === 0 ? (
					<div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
						Нет активных запросов на вывод
					</div>
				) : (
					<div style={{ overflowX: 'auto' }}>
						<table className="table">
							<thead>
								<tr>
									<th>Сумма</th>
									<th>Статус</th>
									<th>Дата запроса</th>
									<th>Дейтвия</th>
								</tr>
							</thead>
							<tbody>
								{withdrawalRequests.map((request, index) => (
									<tr key={index}>
										<td>{(request.amount / 1e9).toFixed(4)} SOL</td>
										<td>
											<span style={{
												color: request.status === 'approved' ? '#4caf50' :
													request.status === 'pending' ? '#ff9800' :
														request.status === 'completed' ? '#2196f3' : '#f44336',
												fontWeight: 'bold'
											}}>
												{request.status === 'pending' ? 'Ожидает' :
													request.status === 'approved' ? 'Одобрен' :
														request.status === 'completed' ? 'Выполнен' : request.status}
											</span>
										</td>
										<td>{request.requested_at ? new Date(request.requested_at).toLocaleString() : '-'}</td>
										<td>
											{request.status === 'pending' &&
												<button onClick={() => deleteWithdrawalRequests(request.id!)}
													style={{ backgroundColor: '#f44336', color: 'white', padding: '3px 8px', borderColor: 'transparent', borderRadius: '5px' }}>
													Cancel
												</button>
											}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	)
}
