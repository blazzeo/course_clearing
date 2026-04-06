import axios from 'axios'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { API_URL } from '../main'
import { getAllParticipants, getClearingState, getUserRole, updateFeeRate, useProgram } from '../api'
import { Participant, UserType, UserTypeToString } from '../interfaces'
import { ClipLoader } from 'react-spinners'

export interface SystemSetting {
	key: string,
	value: string,
	description?: string,
}

function formatTimeExtended(seconds: number): string {
	const units = [
		{ label: "мес", value: 30 * 24 * 3600 }, // ~30 дней
		{ label: "д", value: 24 * 3600 },
		{ label: "ч", value: 3600 },
		{ label: "мин", value: 60 },
		{ label: "с", value: 1 },
	];

	let result: string[] = [];

	for (const unit of units) {
		const amount = Math.floor(seconds / unit.value);
		if (amount > 0) {
			result.push(`${amount} ${unit.label}`);
			seconds %= unit.value;
		}
	}

	return result.length > 0 ? result.join(" ") : "0 с";
}

export default function AdminPanel() {
	const [allUsers, setAllUsers] = useState<Participant[]>([])
	const [systemSettings, setSystemSettings] = useState<SystemSetting[]>([])
	const [loading, setLoading] = useState(true)
	const [isAdmin, setIsAdmin] = useState(false)
	const [checkingAdmin, setCheckingAdmin] = useState(true)
	const [actionLoading, setActionLoading] = useState(false)
	const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'system'>('users')
	const [newFeeRate, setNewFeeRate] = useState<number>(0)
	const [newIntervalTime, setNewIntervalTime] = useState<number>(0)

	const { publicKey, signMessage } = useWallet()
	const program = useProgram()

	useEffect(() => {
		checkAdminStatus()
	}, [publicKey])

	const checkAdminStatus = async () => {
		if (!publicKey || !program) {
			setCheckingAdmin(false)
			return
		}

		try {
			let role = await getUserRole(program, publicKey);
			console.log(role)
			if (role == UserType.Administator)
				setIsAdmin(true)
		} catch (error) {
			console.error('Error checking admin status:', error)
			toast.error('Ошибка при проверке прав администратора')
		} finally {
			setCheckingAdmin(false)
		}
	}

	//	TODO: fix clearing response logic
	const executeClearingHandler = async () => {
		if (!publicKey || !program || !signMessage) {
			toast.error("Кошелек не найден")
			return
		}

		try {
			setActionLoading(true)

			const message = "clear";
			const encodedMessage = new TextEncoder().encode(message);

			const signature = await signMessage(encodedMessage);

			console.log("Signature:", signature);

			const signatureBase64 = btoa(
				String.fromCharCode(...signature)
			);

			console.log({ message: message, signature: signatureBase64 });

			let res = await axios.post(
				`${API_URL}/api/clearing/run`,
				{
					message,
					signature: signatureBase64,
				},
				{
					headers: {
						"Content-Type": "application/json",
					},
				}
			);

			console.log(res)
		} catch (error) {
			console.error('Error executing clearing:', error)
			toast.error('Ошибка при проведении операции')
		} finally {
			setActionLoading(false)
		}
	}

	useEffect(() => {
		if (isAdmin) {
			loadAllUsers()
			loadSystemSettings()
		}
	}, [isAdmin])

	const loadAllUsers = async () => {
		if (!program)
			return

		try {
			const participants = await getAllParticipants(program)
			console.log("participants: ", participants)
			setAllUsers(participants)
		} catch (error) {
			console.error('Error loading users:', error)
			toast.error('Ошибка при загрузке списка пользователей')
		}
	}

	const loadSystemSettings = async () => {
		if (!publicKey || !program)
			return

		try {
			setLoading(true)

			const state = await getClearingState(program)

			const feeRateSetting: SystemSetting = {
				key: 'Fee Rate Bps',
				value: state.feeRateBps.toNumber(),
				description: 'Процент комиссии от сделки'
			}

			const sessionIntervalSetting: SystemSetting = {
				key: 'Session Interval Time',
				value: formatTimeExtended(state.sessionIntervalTime.toNumber()),
				description: 'Интервал времени между сессиями клиринга'
			}

			setSystemSettings([feeRateSetting, sessionIntervalSetting])
		} catch (error) {
			console.error('Error loading settings:', error)
			toast.error('Ошибка при загрузке системных настроек')
		} finally {
			setLoading(false)
		}
	}

	const updateFeeRateHandler = async () => {
		if (!publicKey || !program) {
			toast.error('No wallet found')
			return;
		}

		try {
			await updateFeeRate(program, newFeeRate)

			toast.success('Процент комиссий успешно обновлен')
		} catch (error) {
			console.error('Error updating fee rate: ', error)
			toast.error('Ошибка при обновлении процента комиссий')
		}
	}

	const updateSessionIntervalTimeHandler = async () => {
		if (!publicKey || !program) {
			toast.error('No wallet found')
			return;
		}

		try {
			await updateFeeRate(program, newFeeRate)

			toast.success('Интервал сессий успешно обновлен')
		} catch (error) {
			console.error('Error updating session interval: ', error)
			toast.error('Ошибка при обновлении интервала сессий')
		}
	}

	if (checkingAdmin) {
		return <div className="card">Проверка прав доступа...</div>
	}

	if (!publicKey) {
		return <div className="card">Подключите кошелек для доступа к админ панели</div>
	}

	if (!isAdmin) {
		return <div className="card">У вас нет прав доступа к админ панели</div>
	}

	return (
		<div style={{ maxWidth: '1200px', margin: '0 auto' }}>
			<h1 style={{ marginBottom: '24px', color: '#fff' }}>Админ панель</h1>

			{/* Tabs */}
			<div style={{ marginBottom: '24px' }}>
				<div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
					<button
						onClick={() => setActiveTab('users')}
						style={{
							fontSize: 16,
							padding: '12px 24px',
							border: 'none',
							fontWeight: activeTab === 'users' ? 'bold' : 'normal',
							background: activeTab === 'users' ? '#667eea' : 'transparent',
							color: activeTab === 'users' ? 'white' : '#ddd',
							cursor: 'pointer',
							borderBottom: activeTab === 'users' ? '2px solid #667eea' : 'none'
						}}
					>
						Список пользователей
					</button>
					<button
						onClick={() => setActiveTab('settings')}
						style={{
							fontSize: 16,
							padding: '12px 24px',
							border: 'none',
							fontWeight: activeTab === 'settings' ? 'bold' : 'normal',
							background: activeTab === 'settings' ? '#667eea' : 'transparent',
							color: activeTab === 'settings' ? 'white' : '#ddd',
							cursor: 'pointer',
							borderBottom: activeTab === 'settings' ? '2px solid #667eea' : 'none'
						}}
					>
						Настройки системы
					</button>
					<button
						onClick={() => setActiveTab('system')}
						style={{
							fontSize: 16,
							padding: '12px 24px',
							border: 'none',
							fontWeight: activeTab === 'system' ? 'bold' : 'normal',
							background: activeTab === 'system' ? '#667eea' : 'transparent',
							color: activeTab === 'system' ? 'white' : '#ddd',
							cursor: 'pointer',
							borderBottom: activeTab === 'system' ? '2px solid #667eea' : 'none'
						}}
					>
						Действия системы
					</button>
				</div>
			</div>

			{/* Users Management Tab */}
			{activeTab === 'users' && (
				<div>
					{/* Список всех пользователей */}
					<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Все пользователи системы</h3>
						{loading ? (
							<div style={{ display: 'flex', flexDirection: 'column', padding: "40px 0", alignItems: "center", justifyContent: "center" }}>
								<ClipLoader size={56} speedMultiplier={0.7} />
								<p>Загрузка...</p>
							</div>
						) : allUsers.length === 0 ? (
							<div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
								Пользователей пока нет
							</div>
						) : (
							<div style={{ overflowX: 'auto' }}>
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ background: '#f5f5f5' }}>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Адрес</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Роль</th>
										</tr>
									</thead>
									<tbody>
										{allUsers.map((user) => (
											<tr key={user.authority.toBase58()} style={{ borderBottom: '1px solid #eee' }}>
												<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
													<Link to={`/participant/${user.authority.toBase58()}`}>{user.authority.toBase58()}</Link>
												</td>
												<td style={{ padding: '12px' }}>
													{UserTypeToString(user.userType)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</div>
			)}

			{/* System Settings Tab */}
			{activeTab === 'settings' && (
				<div>
					{/* Список настроек */}
					<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Системные настройки</h3>
						{loading ? (
							<div style={{ padding: '20px' }}>Загрузка...</div>
						) : systemSettings.length === 0 ? (
							<div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
								Настроек пока нет
							</div>
						) : (
							<div style={{ overflowX: 'auto' }}>
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ background: '#f5f5f5' }}>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Ключ</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Значение</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Описание</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Обновлено</th>
										</tr>
									</thead>
									<tbody>
										{systemSettings.map((setting) => (
											<tr key={setting.key} style={{ borderBottom: '1px solid #eee' }}>
												<td style={{ padding: '12px', fontWeight: 'bold' }}>{setting.key}</td>
												<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
													{setting.value}
												</td>
												<td style={{ padding: '12px' }}>{setting.description || '-'}</td>
												<td style={{ padding: '12px' }}>
													TEST
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

			{/* System Actions Tab */}
			{
				activeTab === 'system' && (
					<div>
						<div style={{ display: 'grid', gap: '24px' }}>
							{/* Запуск клиринга */}
							<div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
								<h3 style={{ marginBottom: '16px' }}>Запуск процедуры клиринга</h3>
								<p style={{ marginBottom: '16px', color: '#666' }}>
									Эта операция проведет неттинг всех подтвержденных позиций и создаст транзакции для расчетов.
								</p>
								<button
									onClick={executeClearingHandler}
									disabled={actionLoading}
									style={{
										padding: '12px 24px',
										background: actionLoading ? '#ccc' : '#ff9800',
										color: 'white',
										border: 'none',
										borderRadius: '4px',
										cursor: actionLoading ? 'not-allowed' : 'pointer',
										fontSize: '16px',
										fontWeight: 'bold'
									}}
								>
									{actionLoading ? 'Выполнение клиринга...' : 'Запустить клиринг'}
								</button>
							</div>

						</div>
					</div>
				)
			}
		</div >
	)
}
