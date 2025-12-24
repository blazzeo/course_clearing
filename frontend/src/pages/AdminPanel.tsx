import { useEffect, useState } from 'react'
import axios from 'axios'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { API_URL, RPC_URL } from '../App'
import { Transaction, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js"

interface ParticipantData {
	id?: number,
	address: string,
	user_type: string,
	email?: string,
	first_name?: string,
	last_name?: string,
	phone?: string,
	company?: string,
	is_active: boolean,
	balance: number,
	created_at: string,
	updated_at?: string
}

interface SystemSetting {
	id: number,
	key: string,
	value: string,
	description?: string,
	created_at: string,
	updated_at: string
}

interface WithdrawalData {
	participant: string,
	amount: number,
	status: string,
	requested_at: string,
	approved_at?: string,
	completed_at?: string,
	tx_signature?: string,
	created_at: string,
	pda: string
}

export default function AdminPanel() {
	const [admins, setAdmins] = useState<ParticipantData[]>([])
	const [allUsers, setAllUsers] = useState<ParticipantData[]>([])
	const [systemSettings, setSystemSettings] = useState<SystemSetting[]>([])
	const [withdrawals, setWithdrawals] = useState<WithdrawalData[]>([])
	const [loading, setLoading] = useState(true)
	const [isAdmin, setIsAdmin] = useState(false)
	const [checkingAdmin, setCheckingAdmin] = useState(true)
	const [newAdminAddress, setNewAdminAddress] = useState('')
	const [actionLoading, setActionLoading] = useState(false)
	const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'system' | 'withdrawals'>('users')
	const [newSetting, setNewSetting] = useState({ key: '', value: '', description: '' })

	const [roleFilter, setRoleFilter] = useState<'all' | string>('all')
	const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
	const [filteredUsers, setFilteredUsers] = useState<ParticipantData[]>([])

	const { publicKey, sendTransaction } = useWallet()

	useEffect(() => {
		if (isAdmin) {
			loadAdmins()
			loadAllUsers()
			loadSystemSettings()
			loadWithdrawals()
		}
	}, [isAdmin])

	useEffect(() => {
		checkAdminStatus()
	}, [publicKey])

	useEffect(() => {
		const filtered = allUsers.filter(user => {
			const notAdminHimself = user.address !== publicKey?.toString();

			const roleMatch =
				roleFilter === 'all' || user.user_type === roleFilter;

			const statusMatch =
				statusFilter === 'all' ||
				(statusFilter === 'active' && user.is_active) ||
				(statusFilter === 'inactive' && !user.is_active);

			return roleMatch && statusMatch && notAdminHimself;
		});

		setFilteredUsers(filtered)
	}, [statusFilter, roleFilter, allUsers])


	const checkAdminStatus = async () => {
		if (!publicKey) {
			setCheckingAdmin(false)
			return
		}

		try {
			const userAddress = publicKey.toBase58()
			const response = await axios.get(`${API_URL}/api/admins/check/${userAddress}`)
			if (response.data.success) {
				setIsAdmin(response.data.data)
			}
		} catch (error) {
			console.error('Error checking admin status:', error)
			toast.error('Ошибка при проверке прав администратора')
		} finally {
			setCheckingAdmin(false)
		}
	}

	const executeClearingHandler = async () => {
		if (!publicKey) {
			toast.error("Кошелек не найден")
			return
		}

		try {
			let res = await axios.post(`${API_URL}/api/clearing/run`)

		} catch (error) {
			console.error('Error executing clearing:', error)
			toast.error('Ошибка при проведении операции')
		}
	}

	useEffect(() => {
		if (isAdmin) {
			loadAdmins()
			loadAllUsers()
			loadSystemSettings()
			loadWithdrawals()
		}
	}, [isAdmin])

	const loadAdmins = async () => {
		try {
			const response = await axios.get(`${API_URL}/api/admins`)
			if (response.data.success) {
				setAdmins(response.data.data || [])
			}
		} catch (error) {
			console.error('Error loading admins:', error)
			toast.error('Ошибка при загрузке списка админов')
		}
	}

	const loadAllUsers = async () => {
		try {
			const response = await axios.get(`${API_URL}/api/participants`)
			if (response.data.success) {
				setAllUsers(response.data.data || [])
			}


		} catch (error) {
			console.error('Error loading users:', error)
			toast.error('Ошибка при загрузке списка пользователей')
		}
	}

	const loadSystemSettings = async () => {
		try {
			setLoading(true)
			const response = await axios.get(`${API_URL}/api/system/settings`)
			if (response.data.success) {
				setSystemSettings(response.data.data || [])
			}
		} catch (error) {
			console.error('Error loading settings:', error)
			toast.error('Ошибка при загрузке системных настроек')
		} finally {
			setLoading(false)
		}
	}

	const loadWithdrawals = async () => {
		try {
			const response = await axios.get(`${API_URL}/api/admin/withdrawals?admin_address=${publicKey?.toBase58()}`)
			if (response.data.success) {
				setWithdrawals(response.data.data || [])
			}
		} catch (error) {
			console.error('Error loading withdrawals:', error)
			toast.error('Ошибка при загрузке запросов на вывод')
		}
	}

	const approveWithdrawal = async (participantAddress: string, withdrawalPda?: String) => {
		if (!publicKey) {
			toast.error('Подключите кошелек')
			return
		}

		try {
			setActionLoading(true)
			const response = await axios.post(`${API_URL}/api/blockchain/withdraw/approve?admin_address=${publicKey?.toBase58()}`, {
				withdrawal_address: participantAddress,
				withdrawal_pda: withdrawalPda
			})

			if (response.data.success) {
				const instructionData = response.data.data.instruction

				if (!Array.isArray(instructionData.data)) {
					throw new Error('Invalid instruction data format')
				}

				const ix = new TransactionInstruction({
					programId: new PublicKey(instructionData.program_id),
					keys: instructionData.accounts.map((acc: any) => ({
						pubkey: new PublicKey(acc.pubkey),
						isSigner: acc.is_signer,
						isWritable: acc.is_writable
					})),
					data: new Uint8Array(instructionData.data) as Buffer,
				})

				const connection = new Connection(RPC_URL, "confirmed")
				const tx = new Transaction().add(ix)
				tx.feePayer = publicKey

				const { blockhash } = await connection.getRecentBlockhash()
				tx.recentBlockhash = blockhash

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
					simulationResult.value.logs.forEach((log, index) => {
						console.log(`Лог ${index}:`, log)
					})
				}

				const signature = await sendTransaction(tx, connection)

				// Обновляем статус в базе данных
				try {
					await axios.post(`${API_URL}/api/blockchain/withdraw/complete`, {
						user_address: participantAddress,
						withdrawal_pda: withdrawalPda,
						tx_signature: signature
					})
				} catch (completeError) {
					console.error('Error completing withdrawal in DB:', completeError)
					toast.warning('Транзакция выполнена, но статус в БД может не обновиться')
				}

				toast.success(`Вывод одобрен! Транзакция: ${signature}`)
				loadWithdrawals() // Перезагружаем список
			} else {
				toast.error(response.data.error || 'Ошибка при одобрении вывода')
			}
		} catch (error: any) {
			console.error('Error approving withdrawal:', error)
			toast.error(error.response?.data?.error || 'Ошибка при одобрении вывода')
		} finally {
			setActionLoading(false)
		}
	}

	const addAdmin = async () => {
		if (!newAdminAddress.trim()) {
			toast.error('Введите адрес пользователя')
			return
		}

		try {
			setActionLoading(true)
			const response = await axios.post(`${API_URL}/api/admins/add`, {
				address: newAdminAddress.trim(),
				user_type: 'admin'
			})

			if (response.data.success) {
				toast.success('Админ успешно добавлен')
				setNewAdminAddress('')
				loadAdmins() // Перезагружаем список
			} else {
				toast.error(response.data.error || 'Ошибка при добавлении админа')
			}
		} catch (error: any) {
			console.error('Error adding admin:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при добавлении админа'
			toast.error(errorMessage)
		} finally {
			setActionLoading(false)
		}
	}

	const changeUserRole = async (address: string, newRole: string) => {
		if (!confirm(`Вы уверены, что хотите изменить роль пользователя ${address.slice(0, 8)}...${address.slice(-8)} на "${newRole}"?`)) {
			return
		}

		try {
			setActionLoading(true)
			const response = await axios.post(`${API_URL}/api/admin/change-role?admin_address=${publicKey?.toBase58()}`, {
				address,
				user_type: newRole
			})

			if (response.data.success) {
				toast.success('Роль пользователя изменена')
				loadAllUsers()
				loadAdmins()
			} else {
				toast.error(response.data.error || 'Ошибка при изменении роли')
			}
		} catch (error: any) {
			console.error('Error changing role:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при изменении роли'
			toast.error(errorMessage)
		} finally {
			setActionLoading(false)
		}
	}

	const toggleUserStatus = async (address: string, isActive: boolean) => {
		const action = isActive ? 'деактивиров' : 'активиров'
		if (!confirm(`Вы уверены, что хотите ${action}ать пользователя ${address.slice(0, 8)}...${address.slice(-8)}?`)) {
			return
		}

		try {
			setActionLoading(true)
			const endpoint = isActive ? 'deactivate' : 'activate'
			const response = await axios.post(`${API_URL}/api/admin/${endpoint}?admin_address=${publicKey?.toBase58()}`, {
				address
			})

			if (response.data.success) {
				toast.success(`Пользователь ${action}ан`)
				loadAllUsers()
			} else {
				toast.error(response.data.error || `Ошибка при ${action}ции пользователя`)
			}
		} catch (error: any) {
			console.error(`Error ${action}ing user:`, error)
			const errorMessage = error.response?.data?.error || `Ошибка при ${action}ции пользователя`
			toast.error(errorMessage)
		} finally {
			setActionLoading(false)
		}
	}

	const deleteUser = async (address: string) => {
		if (!confirm(`Вы уверены, что хотите удалить пользователя ${address.slice(0, 8)}...${address.slice(-8)}? Это действие нельзя отменить!`)) {
			return
		}

		try {
			setActionLoading(true)
			const response = await axios.delete(`${API_URL}/api/admin/delete/${address}?admin_address=${publicKey?.toBase58()}`)

			if (response.data.success) {
				toast.success('Пользователь удален')
				loadAllUsers()
				loadAdmins()
			} else {
				toast.error(response.data.error || 'Ошибка при удалении пользователя')
			}
		} catch (error: any) {
			console.error('Error deleting user:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при удалении пользователя'
			toast.error(errorMessage)
		} finally {
			setActionLoading(false)
		}
	}

	const removeAdmin = async (address: string) => {
		await changeUserRole(address, 'counterparty')
	}

	const updateSystemSetting = async () => {
		if (!newSetting.key.trim() || !newSetting.value.trim()) {
			toast.error('Заполните ключ и значение настройки')
			return
		}

		try {
			setActionLoading(true)
			const response = await axios.post(`${API_URL}/api/system/settings?admin_address=${publicKey?.toBase58()}`, newSetting)

			if (response.data.success) {
				toast.success('Настройка обновлена')
				setNewSetting({ key: '', value: '', description: '' })
				loadSystemSettings()
			} else {
				toast.error(response.data.error || 'Ошибка при обновлении настройки')
			}
		} catch (error: any) {
			console.error('Error updating setting:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при обновлении настройки'
			toast.error(errorMessage)
		} finally {
			setActionLoading(false)
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
						Управление пользователями
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
					<button
						onClick={() => setActiveTab('withdrawals')}
						style={{
							fontSize: 16,
							padding: '12px 24px',
							border: 'none',
							fontWeight: activeTab === 'withdrawals' ? 'bold' : 'normal',
							background: activeTab === 'withdrawals' ? '#667eea' : 'transparent',
							color: activeTab === 'withdrawals' ? 'white' : '#ddd',
							cursor: 'pointer',
							borderBottom: activeTab === 'withdrawals' ? '2px solid #667eea' : 'none'
						}}
					>
						Запросы на вывод
					</button>
				</div>
			</div>

			{/* Users Management Tab */}
			{activeTab === 'users' && (
				<div>
					{/* Форма добавления админа */}
					<div style={{ marginBottom: '32px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
						<h3 style={{ marginBottom: '16px' }}>Добавить администратора</h3>
						<div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
							<input
								type="text"
								value={newAdminAddress}
								onChange={(e) => setNewAdminAddress(e.target.value)}
								placeholder="Введите Solana адрес пользователя"
								style={{
									flex: 1,
									padding: '8px 12px',
									border: '1px solid #ccc',
									borderRadius: '4px',
									fontFamily: 'monospace',
									fontSize: '14px'
								}}
							/>
							<button
								onClick={addAdmin}
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
								{actionLoading ? 'Добавление...' : 'Добавить'}
							</button>
						</div>
					</div>

					{/* Список всех пользователей */}
					<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Все пользователи системы</h3>
						{loading ? (
							<div style={{ padding: '20px' }}>Загрузка...</div>
						) : allUsers.length === 0 ? (
							<div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
								Пользователей пока нет
							</div>
						) : (

							<div style={{ overflowX: 'auto' }}>
								<div style={{ padding: '0 20px 16px 20px', display: 'flex', gap: '12px' }}>
									<select
										value={roleFilter}
										onChange={(e) => setRoleFilter(e.target.value)}
										style={{ padding: '6px', borderRadius: '4px' }}
									>
										<option value="all">Все роли</option>
										<option value="guest">Гость</option>
										<option value="counterparty">Контрагент</option>
										<option value="auditor">Аудитор</option>
										<option value="administrator">Администратор</option>
									</select>

									<select
										value={statusFilter}
										onChange={(e) => setStatusFilter(e.target.value as any)}
										style={{ padding: '6px', borderRadius: '4px' }}
									>
										<option value="all">Любой статус</option>
										<option value="active">Активные</option>
										<option value="inactive">Деактивированные</option>
									</select>
								</div>
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ background: '#f5f5f5' }}>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Адрес</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Роль</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Статус</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Действия</th>
										</tr>
									</thead>
									<tbody>
										{filteredUsers.length > 0 &&
											filteredUsers.map((user) => (
												<tr key={user.address} style={{ borderBottom: '1px solid #eee' }}>
													<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
														{user.address.slice(0, 8)}...{user.address.slice(-8)}
													</td>
													<td style={{ padding: '12px' }}>
														{user.user_type === 'guest' ? 'Гость' :
															user.user_type === 'counterparty' ? 'Контрагент' :
																user.user_type === 'auditor' ? 'Аудитор' :
																	user.user_type === 'administrator' ? 'Администратор' : user.user_type}
													</td>
													<td style={{ padding: '12px' }}>
														<span style={{
															color: user.is_active ? '#4caf50' : '#f44336',
															fontWeight: 'bold'
														}}>
															{user.is_active ? 'Активен' : 'Деактивирован'}
														</span>
													</td>
													<td style={{ padding: '12px' }}>
														<div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
															<select
																value={user.user_type}
																onChange={(e) => changeUserRole(user.address, e.target.value)}
																disabled={actionLoading}
																style={{
																	padding: '4px 8px',
																	border: '1px solid #ccc',
																	borderRadius: '4px',
																	fontSize: '12px'
																}}
															>
																<option value="guest">Гость</option>
																<option value="counterparty">Контрагент</option>
																<option value="auditor">Аудитор</option>
																<option value="administrator">Администратор</option>
															</select>
															<button
																onClick={() => toggleUserStatus(user.address, user.is_active)}
																disabled={actionLoading}
																style={{
																	padding: '4px 8px',
																	background: user.is_active ? '#ff9800' : '#4caf50',
																	color: 'white',
																	border: 'none',
																	borderRadius: '4px',
																	cursor: actionLoading ? 'not-allowed' : 'pointer',
																	fontSize: '12px'
																}}
															>
																{user.is_active ? 'Деакт.' : 'Акт.'}
															</button>
															<button
																onClick={() => deleteUser(user.address)}
																disabled={actionLoading}
																style={{
																	padding: '4px 8px',
																	background: '#f44336',
																	color: 'white',
																	border: 'none',
																	borderRadius: '4px',
																	cursor: actionLoading ? 'not-allowed' : 'pointer',
																	fontSize: '12px'
																}}
															>
																Удалить
															</button>
														</div>
													</td>
												</tr>
											))
										}
									</tbody>
								</table>
								{filteredUsers.length == 0 &&
									<p style={{ fontSize: '20px', textAlign: 'center', margin: '10px auto', fontWeight: 'bold', color: '#ff4444' }}>No users found</p>
								}
							</div>
						)}
					</div>
				</div>
			)}

			{/* System Settings Tab */}
			{activeTab === 'settings' && (
				<div>
					{/* Форма добавления/обновления настройки */}
					<div style={{ marginBottom: '32px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
						<h3 style={{ marginBottom: '16px' }}>Добавить/обновить системную настройку</h3>
						<div style={{ display: 'grid', gap: '12px' }}>
							<input
								type="text"
								value={newSetting.key}
								onChange={(e) => setNewSetting({ ...newSetting, key: e.target.value })}
								placeholder="Ключ настройки"
								style={{
									padding: '8px 12px',
									border: '1px solid #ccc',
									borderRadius: '4px'
								}}
							/>
							<input
								type="text"
								value={newSetting.value}
								onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
								placeholder="Значение настройки"
								style={{
									padding: '8px 12px',
									border: '1px solid #ccc',
									borderRadius: '4px'
								}}
							/>
							<input
								type="text"
								value={newSetting.description}
								onChange={(e) => setNewSetting({ ...newSetting, description: e.target.value })}
								placeholder="Описание настройки"
								style={{
									padding: '8px 12px',
									border: '1px solid #ccc',
									borderRadius: '4px'
								}}
							/>
							<button
								onClick={updateSystemSetting}
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
								{actionLoading ? 'Обновление...' : 'Обновить настройку'}
							</button>
						</div>
					</div>

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
											<tr key={setting.id} style={{ borderBottom: '1px solid #eee' }}>
												<td style={{ padding: '12px', fontWeight: 'bold' }}>{setting.key}</td>
												<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
													{setting.value}
												</td>
												<td style={{ padding: '12px' }}>{setting.description || '-'}</td>
												<td style={{ padding: '12px' }}>
													{new Date(setting.updated_at).toLocaleString()}
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

			{/* System Actions Tab */}
			{activeTab === 'system' && (
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

						{/* Инициализация escrow */}
						<div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
							<h3 style={{ marginBottom: '16px' }}>Инициализация Escrow</h3>
							<p style={{ marginBottom: '16px', color: '#666' }}>
								Инициализация глобального escrow аккаунта для хранения средств в смарт-контракте.
								Это необходимо сделать один раз перед началом работы системы.
							</p>
							<button
								onClick={async () => {
									if (!publicKey) {
										toast.error('Подключите кошелек');
										return;
									}

									if (!confirm('Вы уверены, что хотите инициализировать escrow аккаунт?')) return;

									try {
										setActionLoading(true);
										const response = await axios.post(`${API_URL}/api/admin/initialize-escrow?admin_address=${publicKey?.toBase58()}`);
										if (response.data.success) {
											if (response.data.data.initialized) {
												toast.success('Escrow уже инициализирован');
											} else {
												// Escrow не инициализирован - отправляем транзакцию
												const instructionData = response.data.data.instruction;

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

												const connection = new Connection(RPC_URL, "confirmed");
												const tx = new Transaction().add(ix);
												tx.feePayer = publicKey;

												const { blockhash } = await connection.getRecentBlockhash();
												tx.recentBlockhash = blockhash;

												const signature = await sendTransaction(tx, connection);
												toast.success(`Escrow инициализирован! Транзакция: ${signature}`);
											}
										} else {
											toast.error(response.data.error || 'Ошибка при проверке escrow');
										}
									} catch (error: any) {
										toast.error(error.response?.data?.error || 'Ошибка при инициализации escrow');
									} finally {
										setActionLoading(false);
									}
								}}
								disabled={actionLoading}
								style={{
									padding: '12px 24px',
									background: actionLoading ? '#ccc' : '#4caf50',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: actionLoading ? 'not-allowed' : 'pointer',
									fontSize: '16px',
									fontWeight: 'bold'
								}}
							>
								{actionLoading ? 'Проверка...' : 'Инициализировать Escrow'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Withdrawals Management Tab */}
			{activeTab === 'withdrawals' && (
				<div>
					<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<div style={{ padding: '20px 20px 0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<h3 style={{ marginBottom: '16px' }}>Запросы на вывод средств</h3>
							<button
								onClick={loadWithdrawals}
								disabled={actionLoading}
								style={{
									padding: '8px 16px',
									background: actionLoading ? '#ccc' : '#667eea',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: actionLoading ? 'not-allowed' : 'pointer',
									fontSize: '14px'
								}}
							>
								Обновить
							</button>
						</div>
						{withdrawals.length === 0 ? (
							<div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
								Нет активных запросов на вывод
							</div>
						) : (
							<div style={{ overflowX: 'auto' }}>
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ background: '#f5f5f5' }}>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Участник</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Сумма</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Статус</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Запрошено</th>
											<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Действия</th>
										</tr>
									</thead>
									<tbody>
										{withdrawals.map((withdrawal) => (
											<tr key={withdrawal.participant + withdrawal.requested_at} style={{ borderBottom: '1px solid #eee' }}>
												<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
													{withdrawal.participant.slice(0, 8)}...{withdrawal.participant.slice(-8)}
												</td>
												<td style={{ padding: '12px', textAlign: 'right' }}>
													{(withdrawal.amount / 1e9).toFixed(4)} SOL
												</td>
												<td style={{ padding: '12px' }}>
													<span style={{
														color: withdrawal.status === 'approved' ? '#4caf50' :
															withdrawal.status === 'completed' ? '#2196f3' :
																withdrawal.status === 'rejected' ? '#f44336' : '#ff9800',
														fontWeight: 'bold'
													}}>
														{withdrawal.status === 'pending' ? 'Ожидает' :
															withdrawal.status === 'approved' ? 'Одобрен' :
																withdrawal.status === 'completed' ? 'Выполнен' :
																	withdrawal.status === 'rejected' ? 'Отклонен' : withdrawal.status}
													</span>
												</td>
												<td style={{ padding: '12px', fontSize: '14px' }}>
													{new Date(withdrawal.requested_at).toLocaleString()}
												</td>
												<td style={{ padding: '12px' }}>
													{withdrawal.status === 'pending' && (
														<button
															onClick={() => approveWithdrawal(withdrawal.participant, withdrawal.pda)}
															disabled={actionLoading}
															style={{
																padding: '6px 12px',
																background: actionLoading ? '#ccc' : '#4caf50',
																color: 'white',
																border: 'none',
																borderRadius: '4px',
																cursor: actionLoading ? 'not-allowed' : 'pointer',
																fontSize: '14px'
															}}
														>
															{actionLoading ? 'Обработка...' : 'Одобрить'}
														</button>
													)}
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
		</div>
	)
}
