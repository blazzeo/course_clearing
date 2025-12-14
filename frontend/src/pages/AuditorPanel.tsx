import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'

interface AuditLogEntry {
	id: number
	user_address: string
	action: string
	resource_type: string
	resource_id?: string
	old_values?: any
	new_values?: any
	ip_address?: string
	user_agent?: string
	created_at: string
}

interface BalanceEntry {
	address: string
	balance: number
	user_type: string
	updated_at: string
}

export default function AuditorPanel() {
	const { publicKey } = useWallet()
	const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
	const [balances, setBalances] = useState<BalanceEntry[]>([])
	const [loadingLogs, setLoadingLogs] = useState(true)
	const [loadingBalances, setLoadingBalances] = useState(true)
	const [activeTab, setActiveTab] = useState<'logs' | 'balances'>('logs')

	useEffect(() => {
		if (publicKey) {
			loadAuditLogs()
			loadBalances()
		}
	}, [publicKey])

	const loadAuditLogs = async () => {
		if (!publicKey) return

		try {
			const response = await axios.get(`${API_URL}/api/audit/log?auditor_address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setAuditLogs(response.data.data)
			}
		} catch (error) {
			console.error('Error loading audit logs:', error)
			toast.error('Ошибка загрузки логов аудита')
		} finally {
			setLoadingLogs(false)
		}
	}

	const loadBalances = async () => {
		if (!publicKey) return

		try {
			const response = await axios.get(`${API_URL}/api/audit/balances?auditor_address=${publicKey.toBase58()}`)
			if (response.data.success) {
				setBalances(response.data.data)
			}
		} catch (error) {
			console.error('Error loading balances:', error)
			toast.error('Ошибка загрузки балансов')
		} finally {
			setLoadingBalances(false)
		}
	}

	const formatAddress = (address: string) => {
		return `${address.slice(0, 8)}...${address.slice(-8)}`
	}

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString()
	}

	return (
		<div style={{ maxWidth: '1200px', margin: '0 auto' }}>
			<h1>Панель аудитора</h1>

			{/* Tabs */}
			<div style={{ marginBottom: '24px' }}>
				<div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
					<button
						onClick={() => setActiveTab('logs')}
						style={{
							padding: '12px 24px',
							border: 'none',
							background: activeTab === 'logs' ? '#667eea' : 'transparent',
							color: activeTab === 'logs' ? 'white' : '#666',
							cursor: 'pointer',
							borderBottom: activeTab === 'logs' ? '2px solid #667eea' : 'none'
						}}
					>
						Логи аудита
					</button>
					<button
						onClick={() => setActiveTab('balances')}
						style={{
							padding: '12px 24px',
							border: 'none',
							background: activeTab === 'balances' ? '#667eea' : 'transparent',
							color: activeTab === 'balances' ? 'white' : '#666',
							cursor: 'pointer',
							borderBottom: activeTab === 'balances' ? '2px solid #667eea' : 'none'
						}}
					>
						Балансы контрагентов
					</button>
				</div>
			</div>

			{/* Audit Logs Tab */}
			{activeTab === 'logs' && (
				<div>
					<h2>История действий пользователей</h2>
					{loadingLogs ? (
						<div>Загрузка логов...</div>
					) : (
						<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
							{auditLogs.length === 0 ? (
								<div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
									Логи аудита отсутствуют
								</div>
							) : (
								<div style={{ overflowX: 'auto' }}>
									<table style={{ width: '100%', borderCollapse: 'collapse' }}>
										<thead>
											<tr style={{ background: '#f5f5f5' }}>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Время</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Пользователь</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Действие</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Ресурс</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>ID ресурса</th>
											</tr>
										</thead>
										<tbody>
											{auditLogs.map((log) => (
												<tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
													<td style={{ padding: '12px' }}>{formatDate(log.created_at)}</td>
													<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
														{formatAddress(log.user_address)}
													</td>
													<td style={{ padding: '12px' }}>{log.action}</td>
													<td style={{ padding: '12px' }}>{log.resource_type}</td>
													<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
														{log.resource_id ? formatAddress(log.resource_id) : '-'}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Balances Tab */}
			{activeTab === 'balances' && (
				<div>
					<h2>Текущие балансы контрагентов</h2>
					{loadingBalances ? (
						<div>Загрузка балансов...</div>
					) : (
						<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
							{balances.length === 0 ? (
								<div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
									Балансы отсутствуют
								</div>
							) : (
								<div style={{ overflowX: 'auto' }}>
									<table style={{ width: '100%', borderCollapse: 'collapse' }}>
										<thead>
											<tr style={{ background: '#f5f5f5' }}>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Адрес</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Тип</th>
												<th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>Баланс (лапортов)</th>
												<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Последнее обновление</th>
											</tr>
										</thead>
										<tbody>
											{balances.map((balance) => (
												<tr key={balance.address} style={{ borderBottom: '1px solid #eee' }}>
													<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
														{formatAddress(balance.address)}
													</td>
													<td style={{ padding: '12px' }}>
														{balance.user_type === 'counterparty' ? 'Контрагент' : balance.user_type}
													</td>
													<td style={{
														padding: '12px',
														textAlign: 'right',
														fontWeight: 'bold',
														color: balance.balance >= 0 ? '#4caf50' : '#f44336'
													}}>
														{balance.balance.toLocaleString()}
													</td>
													<td style={{ padding: '12px' }}>{formatDate(balance.updated_at)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	)
}


