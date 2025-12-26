import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect, useState } from 'react'
import axios from 'axios'
import { API_URL } from '../App'

interface SystemInfo {
	total_users: number
	active_counterparties: number
	pending_positions: number
	confirmed_positions: number
	cleared_positions: number
	total_clearing_sessions: number
	system_description: string
}

export default function Home() {
	const { publicKey } = useWallet()
	const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
	const [userRole, setUserRole] = useState<string>('guest')

	useEffect(() => {
		loadSystemInfo()
		loadUserRole()
	}, [publicKey])

	const loadSystemInfo = async () => {
		try {
			const response = await axios.get(`${API_URL}/system/info`)
			if (response.data.success) {
				setSystemInfo(response.data.data)
			}
		} catch (error) {
			console.error('Error loading system info:', error)
		}
	}

	const loadUserRole = async () => {
		if (!publicKey) {
			setUserRole('guest')
			return
		}

		try {
			const response = await axios.get(`${API_URL}/api/profile?address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setUserRole(response.data.data.user_type)
			}
		} catch (error) {
			setUserRole('guest')
		}
	}
	return (
		<div>
			<div className="card" style={{ textAlign: 'center', padding: '48px' }}>
				<h1 style={{ fontSize: '48px', marginBottom: '24px', color: '#333' }}>
					Клиринговый сервис на блокчейне
				</h1>
				<p style={{ fontSize: '20px', color: '#666', marginBottom: '32px' }}>
					Децентрализованный сервис для клиринговых расчетов на Solana
				</p>

				{/* Кнопки действий в зависимости от роли */}
				<div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
					{userRole === 'guest' && publicKey && (
						<>
							<Link to="/profile" className="btn btn-primary">
								Профиль
							</Link>
						</>
					)}
					{userRole === 'counterparty' && (
						<>
							<Link to="/positions/create" className="btn btn-primary">
								Создать позицию
							</Link>
							<Link to="/positions" className="btn btn-secondary">
								Мои позиции
							</Link>
							<Link to="/bills" className="btn btn-secondary">
								Мои счета
							</Link>
							<Link to="/funds" className="btn btn-secondary">
								Управление средствами
							</Link>
						</>
					)}
					{userRole === 'auditor' && (
						<Link to="/auditor" className="btn btn-primary">
							Аудит системы
						</Link>
					)}
					{userRole === 'administrator' && (
						<Link to="/admin" className="btn btn-primary">
							Админ панель
						</Link>
					)}
				</div>
			</div>

			{/* Статистика системы для гостей */}
			{systemInfo && (
				<div className="card" style={{ marginTop: '32px' }}>
					<h2 style={{ marginBottom: '24px', color: '#333' }}>Статистика системы</h2>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
						<div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4caf50' }}>{systemInfo.total_users}</div>
							<div style={{ color: '#666' }}>Всего пользователей</div>
						</div>
						<div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '32px', fontWeight: 'bold', color: '#2196f3' }}>{systemInfo.active_counterparties}</div>
							<div style={{ color: '#666' }}>Активных контрагентов</div>
						</div>
						<div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '32px', fontWeight: 'bold', color: '#ff9800' }}>{systemInfo.pending_positions}</div>
							<div style={{ color: '#666' }}>Ожидающих позиций</div>
						</div>
						<div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '32px', fontWeight: 'bold', color: '#9c27b0' }}>{systemInfo.cleared_positions}</div>
							<div style={{ color: '#666' }}>Выполненных позиций</div>
						</div>
						<div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
							<div style={{ fontSize: '32px', fontWeight: 'bold', color: '#607d8b' }}>{systemInfo.total_clearing_sessions}</div>
							<div style={{ color: '#666' }}>Клиринговых сессий</div>
						</div>
					</div>
				</div>
			)}


			<div className="card" style={{ marginTop: '32px' }}>
				<h2 style={{ marginBottom: '16px', color: '#333' }}>Как это работает</h2>
				<ol style={{ paddingLeft: '24px', color: '#666', lineHeight: '1.8' }}>
					<li style={{ marginBottom: '12px' }}>
						<strong>Подключите кошелек:</strong> Используйте Phantom или Solflare для подключения к сервису
					</li>
					<li style={{ marginBottom: '12px' }}>
						<strong>Создайте счёт для комиссий:</strong> Вам будет необходимо создать счёт, с которого будут списываться комиссии
					</li>
					<li style={{ marginBottom: '12px' }}>
						<strong>Верификация:</strong> Обратитесь к администратору для подтверждения личности
					</li>
					<li style={{ marginBottom: '12px' }}>
						<strong>Создайте позицию:</strong> Укажите контрагента и сумму для клиринга
					</li>
					<li style={{ marginBottom: '12px' }}>
						<strong>Подтверждение:</strong> Контрагент подтверждает позицию
					</li>
					<li style={{ marginBottom: '12px' }}>
						<strong>Выполнение:</strong> Система выполняет клиринг и выставляет счета для оплаты
					</li>
				</ol>
			</div>
		</div>
	)
}






