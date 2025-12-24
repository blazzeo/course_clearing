import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'
import { Transaction, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js"
import { RPC_URL } from '../App'

interface UserProfile {
	address: string
	user_type: string
	email?: string
	first_name?: string
	last_name?: string
	phone?: string
	company?: string
	is_active: boolean
	balance: number
	created_at: string
	updated_at?: string
}

export default function Profile() {
	const { publicKey, sendTransaction } = useWallet()
	const [profile, setProfile] = useState<UserProfile | null>(null)
	const [loading, setLoading] = useState(true)
	const [editing, setEditing] = useState(false)
	const [blockchainInitializing, setBlockchainInitializing] = useState(false)
	const [formData, setFormData] = useState({
		email: '',
		first_name: '',
		last_name: '',
		phone: '',
		company: ''
	})

	useEffect(() => {
		if (publicKey) {
			loadProfile()
		}
	}, [publicKey])

	const initializeBlockchainAccount = async (instructionData: any) => {
		if (!publicKey || !sendTransaction) {
			toast.error('Кошелек не подключен')
			return
		}

		try {
			setBlockchainInitializing(true)

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
			toast.success(`Инициализация в блокчейне завершена! Транзакция: ${signature}`)

			// Перезагружаем профиль после успешной инициализации
			await loadProfile()

		} catch (error) {
			console.error('Error initializing blockchain account:', error)
			toast.error('Ошибка инициализации в блокчейне')
		} finally {
			setBlockchainInitializing(false)
		}
	}

	const loadProfile = async () => {
		if (!publicKey) return

		try {
			const response = await axios.get(`${API_URL}/api/profile?address=${publicKey.toBase58()}`)
			if (response.data.success) {
				const userData = response.data.data
				setProfile(userData)
				setFormData({
					email: userData.email || '',
					first_name: userData.first_name || '',
					last_name: userData.last_name || '',
					phone: userData.phone || '',
					company: userData.company || ''
				})
			}
		} catch (error: any) {
			// Если профиль не найден (404), пытаемся зарегистрировать гостя
			if (error.response?.status === 404) {
				try {
					const registerResponse = await axios.post(`${API_URL}/api/auth/register-guest`, {
						address: publicKey.toBase58()
					})

					if (registerResponse.data.success) {
						const registrationData = registerResponse.data.data

						// Если требуется инициализация в блокчейне, автоматически отправляем транзакцию
						if (!registrationData.blockchain_initialized && registrationData.instruction) {
							toast.info('Регистрация завершена. Выполняется инициализация в блокчейне...', {
								autoClose: 3000
							})

							// Автоматически инициализируем аккаунт в блокчейне
							await initializeBlockchainAccount(registrationData.instruction)
						} else {
							toast.success('Регистрация гостя завершена')
						}

						// Перезагружаем профиль после регистрации
						const profileResponse = await axios.get(`${API_URL}/api/profile?address=${publicKey.toBase58()}`)
						if (profileResponse.data.success) {
							const userData = profileResponse.data.data
							setProfile(userData)
							setFormData({
								email: userData.email || '',
								first_name: userData.first_name || '',
								last_name: userData.last_name || '',
								phone: userData.phone || '',
								company: userData.company || ''
							})
						}
					}
				} catch (registerError) {
					console.error('Error registering guest:', registerError)
					toast.error('Ошибка регистрации гостя')
				}
			} else {
				console.error('Error loading profile:', error)
				toast.error('Ошибка загрузки профиля')
			}
		} finally {
			setLoading(false)
		}
	}

	const handleUpdateProfile = async () => {
		if (!publicKey) return

		try {
			const response = await axios.put(`${API_URL}/api/profile?address=${publicKey.toBase58()}`, formData)
			if (response.data.success) {
				setProfile(response.data.data)
				setEditing(false)
				toast.success('Профиль обновлен')
			}
		} catch (error) {
			console.error('Error updating profile:', error)
			toast.error('Ошибка обновления профиля')
		}
	}

	const handleCancel = () => {
		if (profile) {
			setFormData({
				email: profile.email || '',
				first_name: profile.first_name || '',
				last_name: profile.last_name || '',
				phone: profile.phone || '',
				company: profile.company || ''
			})
		}
		setEditing(false)
	}

	if (loading) {
		return <div>Загрузка профиля...</div>
	}

	if (!profile) {
		return <div>Профиль не найден</div>
	}

	return (
		<div style={{ maxWidth: '800px', margin: '0 auto' }}>
			<h1 style={{ paddingBottom: '30px', color: 'white' }}>Профиль пользователя</h1>

			{/* Плашка для гостей */}
			{profile.user_type === 'guest' && (
				<div style={{
					background: '#fff3cd',
					border: '1px solid #ffeaa7',
					borderRadius: '8px',
					padding: '16px',
					marginBottom: '24px',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: '12px'
				}}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
						<div style={{
							width: '24px',
							height: '24px',
							borderRadius: '50%',
							background: '#856404',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: 'white',
							fontSize: '14px',
							fontWeight: 'bold'
						}}>
							!
						</div>
						<div style={{ flex: 1 }}>
							<h4 style={{ margin: '0 0 4px 0', color: '#856404' }}>
								Аккаунт не верифицирован
							</h4>
							<p style={{ margin: 0, color: '#856404', fontSize: '14px' }}>
								Ваш аккаунт имеет статус "Гость". Для получения полного доступа к системе обратитесь к администратору для верификации аккаунта.
							</p>
						</div>
					</div>
					<div style={{ display: 'flex', gap: '8px' }}>
						<button
							onClick={async () => {
								try {
									const registerResponse = await axios.post(`${API_URL}/api/auth/register-guest`, {
										address: publicKey!.toBase58()
									})

									if (registerResponse.data.success) {
										const registrationData = registerResponse.data.data

										if (!registrationData.blockchain_initialized && registrationData.instruction) {
											await initializeBlockchainAccount(registrationData.instruction)
										} else {
											toast.success('Аккаунт уже инициализирован в блокчейне')
											loadProfile()
										}
									}
								} catch (error) {
									console.error('Error initializing blockchain account:', error)
									toast.error('Ошибка инициализации')
								}
							}}
							disabled={blockchainInitializing}
							style={{
								padding: '8px 16px',
								background: blockchainInitializing ? '#ccc' : '#667eea',
								color: 'white',
								border: 'none',
								borderRadius: '4px',
								cursor: blockchainInitializing ? 'not-allowed' : 'pointer',
								fontSize: '14px'
							}}
						>
							{blockchainInitializing ? 'Инициализация...' : 'Инициализировать в блокчейне'}
						</button>
					</div>
				</div>
			)}

			<div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
				<div style={{ marginBottom: '24px' }}>
					<h3>Основная информация</h3>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Адрес кошелька:</label>
							<div style={{ fontFamily: 'monospace', fontSize: '14px', wordBreak: 'break-all' }}>
								{profile.address}
							</div>
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Роль:</label>
							<div>
								{profile.user_type === 'guest' ? 'Гость' :
									profile.user_type === 'counterparty' ? 'Контрагент' :
										profile.user_type === 'auditor' ? 'Аудитор' :
											profile.user_type === 'administrator' ? 'Администратор' : 'Неизвестно'}
							</div>
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Статус:</label>
							<div>
								{profile.is_active ? 'Активен' : 'Деактивирован'}
							</div>
						</div>
					</div>
				</div>

				<div style={{ marginBottom: '24px' }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
						<h3>Личная информация</h3>
						{!editing ? (
							<button
								onClick={() => setEditing(true)}
								style={{
									padding: '8px 16px',
									background: '#667eea',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: 'pointer'
								}}
							>
								Редактировать
							</button>
						) : (
							<div style={{ display: 'flex', gap: '8px' }}>
								<button
									onClick={handleUpdateProfile}
									style={{
										padding: '8px 16px',
										background: '#4caf50',
										color: 'white',
										border: 'none',
										borderRadius: '4px',
										cursor: 'pointer'
									}}
								>
									Сохранить
								</button>
								<button
									onClick={handleCancel}
									style={{
										padding: '8px 16px',
										background: '#f44336',
										color: 'white',
										border: 'none',
										borderRadius: '4px',
										cursor: 'pointer'
									}}
								>
									Отмена
								</button>
							</div>
						)}
					</div>

					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Email:</label>
							{editing ? (
								<input
									type="email"
									value={formData.email}
									onChange={(e) => setFormData({ ...formData, email: e.target.value })}
									style={{
										width: '100%',
										padding: '8px',
										border: '1px solid #ddd',
										borderRadius: '4px'
									}}
								/>
							) : (
								<div>{profile.email || 'Не указан'}</div>
							)}
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Имя:</label>
							{editing ? (
								<input
									type="text"
									value={formData.first_name}
									onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
									style={{
										width: '100%',
										padding: '8px',
										border: '1px solid #ddd',
										borderRadius: '4px'
									}}
								/>
							) : (
								<div>{profile.first_name || 'Не указано'}</div>
							)}
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Фамилия:</label>
							{editing ? (
								<input
									type="text"
									value={formData.last_name}
									onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
									style={{
										width: '100%',
										padding: '8px',
										border: '1px solid #ddd',
										borderRadius: '4px'
									}}
								/>
							) : (
								<div>{profile.last_name || 'Не указана'}</div>
							)}
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Телефон:</label>
							{editing ? (
								<input
									type="tel"
									value={formData.phone}
									onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
									style={{
										width: '100%',
										padding: '8px',
										border: '1px solid #ddd',
										borderRadius: '4px'
									}}
								/>
							) : (
								<div>{profile.phone || 'Не указан'}</div>
							)}
						</div>
						<div style={{ gridColumn: 'span 2' }}>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Компания:</label>
							{editing ? (
								<input
									type="text"
									value={formData.company}
									onChange={(e) => setFormData({ ...formData, company: e.target.value })}
									style={{
										width: '100%',
										padding: '8px',
										border: '1px solid #ddd',
										borderRadius: '4px'
									}}
								/>
							) : (
								<div>{profile.company || 'Не указана'}</div>
							)}
						</div>
					</div>
				</div>

				<div>
					<h3>Даты</h3>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Дата регистрации:</label>
							<div>{new Date(profile.created_at).toLocaleString()}</div>
						</div>
						<div>
							<label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Последнее обновление:</label>
							<div>{profile.updated_at ? new Date(profile.updated_at).toLocaleString() : 'Не обновлялось'}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
