import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'
import { useWallet } from '@solana/wallet-adapter-react'

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

export default function Funds() {
	const { publicKey, sendTransaction } = useWallet()
	const [balance, setBalance] = useState<BlockchainBalance | null>(null)
	const [loading, setLoading] = useState(true)
	const [actionLoading, setActionLoading] = useState(false)
	const [depositAmount, setDepositAmount] = useState('')
	const [withdrawalAmount, setWithdrawalAmount] = useState('')
	const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>([])

	useEffect(() => {
		if (publicKey) {
			loadBalance()
			loadWithdrawalRequests()
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
		// В будущем здесь можно загрузить активные запросы на вывод
		// Пока оставим пустым
		setWithdrawalRequests([])
	}

	const handleDeposit = async () => {
		if (!publicKey) {
			toast.error('Подключите кошелек')
			return
		}

		const amount = parseFloat(depositAmount)
		if (!amount || amount <= 0) {
			toast.error('Введите корректную сумму')
			return
		}

		try {
			setActionLoading(true)

			// Mock API call - в реальной версии здесь будет взаимодействие с блокчейном
			toast.success(`Депозит ${amount} SOL выполнен (mock)!`)

			// Обновляем баланс
			loadBalance()
			setDepositAmount('')

		} catch (error: any) {
			console.error('Deposit error:', error)
			toast.error(error.message || 'Ошибка депозита')
		} finally {
			setActionLoading(false)
		}
	}

	const handleWithdrawalRequest = async () => {
		if (!publicKey) {
			toast.error('Подключите кошелек')
			return
		}

		const amount = parseFloat(withdrawalAmount)
		if (!amount || amount <= 0) {
			toast.error('Введите корректную сумму')
			return
		}

		try {
			setActionLoading(true)

			// Mock API call
			toast.success(`Запрос на вывод ${amount} SOL создан (mock)!`)

			// Обновляем список запросов
			loadWithdrawalRequests()
			setWithdrawalAmount('')

		} catch (error: any) {
			console.error('Withdrawal request error:', error)
			toast.error(error.message || 'Ошибка запроса на вывод')
		} finally {
			setActionLoading(false)
		}
	}

	if (!publicKey) {
		return <div className="card">Подключите кошелек для управления средствами</div>
	}

	return (
		<div style={{ maxWidth: '800px', margin: '0 auto' }}>
			<h1>Управление средствами</h1>

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
							<div style={{ color: '#666' }}>Заблокировано в контракте</div>
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
								</tr>
							</thead>
							<tbody>
								{withdrawalRequests.map((request, index) => (
									<tr key={index}>
										<td>{(request.amount / 1e9).toFixed(4)} SOL</td>
										<td>
											<span style={{
												color: request.status === 'approved' ? '#4caf50' :
													request.status === 'pending' ? '#ff9800' : '#f44336',
												fontWeight: 'bold'
											}}>
												{request.status === 'pending' ? 'Ожидает' :
													request.status === 'approved' ? 'Одобрен' :
														request.status === 'completed' ? 'Выполнен' : request.status}
											</span>
										</td>
										<td>{request.requested_at ? new Date(request.requested_at).toLocaleString() : '-'}</td>
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
