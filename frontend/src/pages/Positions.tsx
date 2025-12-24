import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { toast } from 'react-toastify'
import { API_URL } from '../App'
import { useWallet } from '@solana/wallet-adapter-react'

interface Position {
	id: number
	creator_address: string
	counterparty_address: string
	amount: number
	status: string
	created_at: string
	confirmed_at: string | null
	cleared_at: string | null
}

function toBase64(bytes: Uint8Array) {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return window.btoa(binary);
}

export default function Positions() {
	const [positions, setPositions] = useState<Position[]>([])
	const [loading, setLoading] = useState(true)
	const [filter, setFilter] = useState<string>('all')
	const [actionLoading, setActionLoading] = useState<number | null>(null)

	const { publicKey, signMessage } = useWallet()

	useEffect(() => {
		loadPositions()
	}, [filter, publicKey])

	const loadPositions = async () => {
		try {
			setLoading(true)
			const url = filter !== 'all'
				? `${API_URL}/api/positions?pbkey=${publicKey}&status=${filter}`
				: `${API_URL}/api/positions?pbkey=${publicKey}`
			const response = await axios.get(url)
			if (response.data.success) {
				setPositions(response.data.data || [])
			}
		} catch (error) {
			console.error('Error loading positions:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleDelete = async (id: number) => {
		if (!publicKey) {
			toast.error('Пожалуйста, подключите кошелек')
			return
		}

		if (!confirm('Вы уверены, что хотите отменить эту позицию?')) {
			return
		}

		try {
			setActionLoading(id)
			const response = await axios.delete(`${API_URL}/api/positions/${id}?pbkey=${publicKey}`)
			if (response.data.success) {
				toast.success('Позиция отменена')
				loadPositions()
			} else {
				toast.error(response.data.error || 'Ошибка при отмене позиции')
			}
		} catch (error: any) {
			console.error('Error deleting position:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при отмене позиции'
			toast.error(errorMessage)
		} finally {
			setActionLoading(null)
		}
	}

	const handleConfirm = async (id: number) => {
		if (!publicKey) {
			toast.error('Пожалуйста, подключите кошелек')
			return
		}

		if (!signMessage) {
			toast.error('Ваш кошелёк не поддерживает подписание сообщений')
			return
		}

		try {
			const timestamp = Math.floor(Date.now() / 1000)

			const message =
				`confirm:${id};` +
				`timestamp:${timestamp}`;

			const messageBytes = new TextEncoder().encode(message);
			const signature = await signMessage(messageBytes);

			const sig_b64 = toBase64(signature);

			await axios.post(`${API_URL}/api/positions/${id}/confirm`, {
				wallet: publicKey.toBase58(),
				position_id: id,
				timestamp,
				signature: sig_b64,
			});

			toast.success('Позиция подтверждена успешно!')
			loadPositions()
		} catch (error) {
			console.error('Error confirming position:', error)
			toast.error('Ошибка при подтверждении позиции')
		}
	}

	const handleClear = async (id: number) => {
		try {
			await axios.post(`${API_URL}/api/positions/${id}/clear`)
			loadPositions()
		} catch (error) {
			console.error('Error clearing position:', error)
			toast.error('Ошибка при выполнении клиринга')
		}
	}

	const getStatusClass = (status: string) => {
		switch (status) {
			case 'pending':
				return 'status-badge status-pending'
			case 'confirmed':
				return 'status-badge status-confirmed'
			case 'cleared':
				return 'status-badge status-cleared'
			default:
				return 'status-badge'
		}
	}

	const formatDate = (dateString: string | null) => {
		if (!dateString) return '-'
		return new Date(dateString).toLocaleString('ru-RU')
	}

	// Если кошелёк не подключён — возвращаем пустую страницу
	if (!publicKey) {
		return <h1 style={{ color: '#eee' }}>Доступно только авторизованным пользователям</h1>
	}

	return (
		<div>
			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
					<h1 style={{ color: '#333' }}>Клиринговые позиции</h1>
					<Link to="/positions/create" className="btn btn-primary">
						Создать позицию
					</Link>
				</div>

				<div style={{ marginBottom: '16px' }}>
					<label className="label">Фильтр по статусу:</label>
					<select
						className="input"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						style={{ width: 'auto', display: 'inline-block', marginLeft: '8px' }}
					>
						<option value="all">Все</option>
						<option value="pending">Ожидают подтверждения</option>
						<option value="confirmed">Подтверждены</option>
						<option value="cleared">Выполнены</option>
					</select>
				</div>

				{loading ? (
					<p>Загрузка...</p>
				) : positions.length === 0 ? (
					<p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
						Позиции не найдены
					</p>
				) : (
					<table className="table">
						<thead>
							<tr>
								<th>ID</th>
								<th>Создатель</th>
								<th>Контрагент</th>
								<th>Сумма</th>
								<th>Статус</th>
								<th>Создано</th>
								<th>Действия</th>
							</tr>
						</thead>
						<tbody>
							{positions.map((position) => (
								<tr key={position.id}>
									<td>{position.id}</td>
									<td>
										<Link to={`/participant/${position.creator_address}`} style={{ color: '#667eea' }}>
											{position.creator_address.slice(0, 8)}...
										</Link>
									</td>
									<td>
										<Link to={`/participant/${position.counterparty_address}`} style={{ color: '#667eea' }}>
											{position.counterparty_address.slice(0, 8)}...
										</Link>
									</td>
									<td>{position.amount / 1e9} SOL</td>
									<td>
										<span className={getStatusClass(position.status)}>
											{position.status === 'pending' && 'Без подтверждения'}
											{position.status === 'confirmed' && 'Подтверждена'}
											{position.status === 'cleared' && 'Выполнена'}
										</span>
									</td>
									<td>{formatDate(position.created_at)}</td>
									<td>
										{position.status === 'pending' && position.counterparty_address === publicKey.toString() && (
											<button
												className="btn btn-primary"
												style={{ padding: '6px 12px', fontSize: '14px' }}
												onClick={() => handleConfirm(position.id)}
												disabled={actionLoading === position.id}
											>
												{actionLoading === position.id ? 'Подтверждение...' : 'Подтвердить'}
											</button>
										)}
										{position.status === 'pending' && position.creator_address === publicKey.toString() && (
											<button
												className="btn btn-danger"
												style={{ padding: '6px 12px', fontSize: '14px', marginLeft: '8px' }}
												onClick={() => handleDelete(position.id)}
												disabled={actionLoading === position.id}
											>
												{actionLoading === position.id ? 'Отмена...' : 'Отменить'}
											</button>
										)}
										{position.status === 'confirmed' && (
											<span style={{ color: '#666' }}>На обработке</span>
										)}
										{position.status === 'cleared' && (
											<span style={{ color: '#666' }}>Завершено</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}






