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
	// Правила клиринга
	clearing_min_participants: number,
	clearing_max_amount: number,
	// Комиссии
	clearing_fee: number,
	transaction_fee: number,
	deposit_fee: number,
	withdrawal_fee: number,
	// Лимиты
	daily_transaction_limit: number,
	monthly_volume_limit: number,
	// Время обновления
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
	const [allUsers, setAllUsers] = useState<ParticipantData[]>([])
	const [withdrawals, setWithdrawals] = useState<WithdrawalData[]>([])
	const [loading, setLoading] = useState(true)
	const [isAdmin, setIsAdmin] = useState(false)
	const [checkingAdmin, setCheckingAdmin] = useState(true)
	const [newAdminAddress, setNewAdminAddress] = useState('')
	const [actionLoading, setActionLoading] = useState(false)
	const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'system' | 'withdrawals'>('users')
	const [systemSettings, setSystemSettings] = useState<SystemSetting | null>(null)
	const [editingSettings, setEditingSettings] = useState<Partial<SystemSetting>>({})
	const [isEditing, setIsEditing] = useState(false)
	const [escrowBalance, setEscrowBalance] = useState<{ total_locked: number, system_fees_collected: number } | null>(null)

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
			loadEscrowBalance()
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
			setActionLoading(true)

			console.log(`[DEBUG] Starting clearing execution for admin:`, publicKey.toBase58())
			console.log(`[DEBUG] Environment info:`, {
				userAgent: navigator.userAgent,
				walletName: 'Phantom', // предполагаем что это Phantom
				solanaWeb3Version: '1.x.x', // версия из package.json
				connectionCommitment: 'confirmed'
			})

			// 1. Рассчитываем клиринг
			toast.info("Рассчитываем клиринг...")
			console.log(`[DEBUG] Requesting clearing calculation from API...`)
			const clearingResponse = await axios.post(`${API_URL}/api/clearing/run?admin_address=${publicKey.toBase58()}`)

			console.log(`[DEBUG] Clearing API response:`, {
				success: clearingResponse.data.success,
				sessionId: clearingResponse.data.data?.session_id,
				settlementsCount: clearingResponse.data.data?.settlements?.length,
				feeInstructionsCount: clearingResponse.data.data?.fee_instructions?.length,
				clearingFeeRate: clearingResponse.data.data?.clearing_fee_rate
			})

			if (!clearingResponse.data.success) {
				throw new Error(clearingResponse.data.error || 'Ошибка расчета клиринга')
			}

			const { fee_instructions, session_id } = clearingResponse.data.data

			if (!fee_instructions || fee_instructions.length === 0) {
				toast.success("Клиринг завершен - нет комиссий для взимания")
				return
			}

			// 2. Выполняем комиссии в блокчейне батчами по 10
			const batchSize = 10
			const totalBatches = Math.ceil(fee_instructions.length / batchSize)
			toast.info(`Выполняем ${fee_instructions.length} комиссий в ${totalBatches} батчах по ${batchSize}...`)

			console.log(`[DEBUG] Starting fee collection:`, {
				totalFees: fee_instructions.length,
				batchSize,
				totalBatches,
				connectionUrl: RPC_URL
			})

			const connection = new Connection(RPC_URL, "confirmed")
			console.log(`[DEBUG] Created Solana connection to:`, RPC_URL)
			const feeSignatures: Array<{ settlement_id: number, signature: string }> = []
			let batchIndex = 0

			for (let i = 0; i < fee_instructions.length; i += batchSize) {
				batchIndex++
				const batch = fee_instructions.slice(i, i + batchSize)
				const batchStart = i + 1
				const batchEnd = Math.min(i + batchSize, fee_instructions.length)

				console.log(`[DEBUG] Starting batch ${batchIndex}/${totalBatches}:`, {
					batchStart,
					batchEnd,
					batchSize: batch.length,
					settlementIds: batch.map(f => f.settlement_id)
				})

				toast.info(`Выполняем батч ${batchIndex}/${totalBatches} (комиссии ${batchStart}-${batchEnd})...`)

				try {
					// Создаем транзакцию с несколькими инструкциями
					const tx = new Transaction()
					const batchSignatures = []

					for (let feeIndex = 0; feeIndex < batch.length; feeIndex++) {
						const fee = batch[feeIndex]

						console.log(`[DEBUG] Creating fee instruction ${batchIndex}.${feeIndex + 1}:`, {
							settlementId: fee.settlement_id,
							fromAddress: fee.from_address,
							feeAmount: fee.fee_amount,
							programId: fee.instruction.program_id,
							dataLength: fee.instruction.data.length,
							accountsCount: fee.instruction.accounts.length
						})

						// Создаем инструкцию
						const ix = new TransactionInstruction({
							programId: new PublicKey(fee.instruction.program_id),
							keys: fee.instruction.accounts.map((acc: any, accIndex: number) => {
								const pubkey = new PublicKey(acc.pubkey)
								console.log(`[DEBUG] Account ${accIndex}:`, {
									pubkey: pubkey.toBase58(),
									isSigner: acc.is_signer,
									isWritable: acc.is_writable,
									isParticipant: accIndex === 0,
									isEscrow: accIndex === 1,
									isAuthority: accIndex === 2
								})
								return {
									pubkey,
									isSigner: acc.is_signer,
									isWritable: acc.is_writable
								}
							}),
							data: Buffer.from(fee.instruction.data),
						})

						// Проверяем данные инструкции
						console.log(`[DEBUG] Instruction data for settlement ${fee.settlement_id}:`, {
							programId: ix.programId.toBase58(),
							keysCount: ix.keys.length,
							dataLength: ix.data.length,
							dataHex: Array.from(ix.data).map(b => b.toString(16).padStart(2, '0')).join(''),
							dataDecoded: {
								discriminator: Array.from(ix.data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(''),
								amount: new DataView(ix.data.buffer).getBigUint64(8, true).toString(),
								reasonLength: ix.data[16],
								reason: new TextDecoder().decode(ix.data.slice(17))
							}
						})

						console.log(`[DEBUG] TransactionInstruction created for settlement ${fee.settlement_id}`)

						tx.add(ix)
						batchSignatures.push(fee.settlement_id)
					}

					// Настраиваем транзакцию
					tx.feePayer = publicKey
					const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
					tx.recentBlockhash = blockhash

					// Note: feePayer будет автоматически подписан wallet adapter

					const currentSlot = await connection.getSlot()
					console.log(`[DEBUG] Blockhash timing:`, {
						blockhash,
						lastValidBlockHeight,
						currentSlot,
						slotsUntilExpiry: lastValidBlockHeight - currentSlot,
						timestamp: new Date().toISOString()
					})

					// Проверяем существование аккаунтов перед отправкой
					console.log(`[DEBUG] Checking accounts existence before sending...`)

					// Специальная проверка PDA аккаунтов
					const programId = tx.instructions[0].programId
					console.log(`[DEBUG] Program ID:`, programId.toBase58())

					for (let accIndex = 0; accIndex < tx.instructions[0].keys.length; accIndex++) {
						const account = tx.instructions[0].keys[accIndex]

						// Рассчитываем ожидаемые PDA для проверки
						let expectedDescription = ''
						if (accIndex === 0) {
							// Participant PDA: [b"participant", authority.key().as_ref(), &[1]]
							const [expectedPda] = await PublicKey.findProgramAddress(
								[new TextEncoder().encode("participant"), tx.instructions[0].keys[2].pubkey.toBytes(), new Uint8Array([1])],
								programId
							)
							expectedDescription = `Expected participant PDA: ${expectedPda.toBase58()}`
						} else if (accIndex === 1) {
							// Escrow PDA: [b"escrow"]
							const [expectedPda] = await PublicKey.findProgramAddress(
								[new TextEncoder().encode("escrow")],
								programId
							)
							expectedDescription = `Expected escrow PDA: ${expectedPda.toBase58()}`
						}

						try {
							const accountInfo = await connection.getAccountInfo(account.pubkey)
							const isExpectedPda = accIndex < 2 ? account.pubkey.equals(
								accIndex === 0 ?
									(await PublicKey.findProgramAddress(
										[new TextEncoder().encode("participant"), tx.instructions[0].keys[2].pubkey.toBytes(), new Uint8Array([1])],
										programId
									))[0] :
									(await PublicKey.findProgramAddress(
										[new TextEncoder().encode("escrow")],
										programId
									))[0]
							) : true

							console.log(`[DEBUG] Account ${accIndex} (${account.isSigner ? 'signer' : account.isWritable ? 'writable' : 'readonly'}):`, {
								pubkey: account.pubkey.toBase58(),
								exists: accountInfo !== null,
								isValidPda: isExpectedPda,
								lamports: accountInfo?.lamports || 0,
								owner: accountInfo?.owner?.toBase58() || null,
								dataLength: accountInfo?.data?.length || 0,
								expected: accIndex < 2 ? expectedDescription : 'N/A'
							})

							if (!accountInfo && accIndex < 2) { // participant и escrow должны существовать
								console.error(`[ERROR] Critical: Account ${accIndex} does not exist:`, account.pubkey.toBase58())
								console.error(`[ERROR] This will cause transaction to fail!`)
							} else if (!isExpectedPda && accIndex < 2) {
								console.error(`[ERROR] PDA mismatch for account ${accIndex}:`, {
									actual: account.pubkey.toBase58(),
									expected: expectedDescription
								})
							}
						} catch (accError) {
							console.error(`[ERROR] Failed to check account ${accIndex}:`, accError)
						}
					}

					// Проверяем баланс fee payer
					const balance = await connection.getBalance(publicKey)
					console.log(`[DEBUG] Fee payer balance:`, {
						pubkey: publicKey.toBase58(),
						balance: balance / 1e9, // в SOL
						lamports: balance
					})

					console.log(`[DEBUG] About to send batch ${batchIndex}:`, {
						instructionsCount: tx.instructions.length,
						batchSignaturesCount: batchSignatures.length,
						feePayer: publicKey.toBase58(),
						blockhash: blockhash,
						recentBlockhash: tx.recentBlockhash
					})

					// Симулируем транзакцию перед отправкой
					console.log(`[DEBUG] Simulating transaction before sending...`)
					const simulationStart = Date.now()
					try {
						const simulation = await connection.simulateTransaction(tx)
						const simulationEnd = Date.now()
						console.log(`[DEBUG] Simulation completed in ${simulationEnd - simulationStart}ms:`, {
							err: simulation.value.err,
							logs: simulation.value.logs,
							accounts: simulation.value.accounts,
							unitsConsumed: simulation.value.unitsConsumed
						})

						if (simulation.value.err) {
							console.error(`[ERROR] Simulation failed:`, simulation.value.err)
							console.error(`[ERROR] Simulation logs:`, simulation.value.logs)
							throw new Error(`Simulation failed: ${simulation.value.err}`)
						}

						console.log(`[DEBUG] Simulation successful, proceeding with transaction...`)
					} catch (simError) {
						console.error(`[ERROR] Simulation error:`, simError)
						throw simError
					}

					// Проверяем свежесть blockhash перед отправкой
					const currentSlotCheck = await connection.getSlot()
					const slotsRemaining = lastValidBlockHeight - currentSlotCheck
					console.log(`[DEBUG] Blockhash freshness check:`, {
						currentSlot: currentSlotCheck,
						lastValidBlockHeight,
						slotsRemaining,
						isFresh: slotsRemaining > 10
					})

					if (slotsRemaining <= 10) {
						console.warn(`[WARN] Blockhash is getting stale (${slotsRemaining} slots remaining), getting fresh one...`)
						const freshBlockhash = await connection.getRecentBlockhash()
						tx.recentBlockhash = freshBlockhash.blockhash
						console.log(`[DEBUG] Updated blockhash:`, freshBlockhash.blockhash)
					}

					// Небольшая задержка между симуляцией и отправкой
					await new Promise(resolve => setTimeout(resolve, 100))

					// Выполняем батч
					// Проверяем что транзакция готова к отправке
					console.log(`[DEBUG] Transaction readiness check:`, {
						hasInstructions: tx.instructions.length > 0,
						hasFeePayer: !!tx.feePayer,
						hasRecentBlockhash: !!tx.recentBlockhash,
						totalSize: tx.serialize().length // размер в байтах
					})

					console.log(`[DEBUG] Sending transaction to blockchain...`)
					const sendStart = Date.now()
					const signature = await sendTransaction(tx, connection)
					const sendEnd = Date.now()
					console.log(`[DEBUG] Transaction sent in ${sendEnd - sendStart}ms, signature:`, signature)
					console.log(`[DEBUG] Transaction sent successfully:`, signature)

					// Сохраняем сигнатуры для всех комиссий в батче
					batchSignatures.forEach(settlementId => {
						feeSignatures.push({
							settlement_id: settlementId,
							signature: signature
						})
					})

					toast.success(`Батч ${batchIndex}/${totalBatches} выполнен: ${signature}`)

				} catch (error: any) {
					console.error(`[ERROR] Batch ${batchIndex} execution failed:`, {
						error: error,
						message: error.message,
						name: error.name,
						code: error.code,
						batchSize: batch.length,
						settlementIds: batch.map((f: any) => f.settlement_id),
						instructionCount: batch.length,
						stack: error.stack
					})

					// Логируем все доступные детали ошибки
					if (error.logs) {
						console.error(`[ERROR] Transaction logs:`, error.logs)
					}
					if (error.transactionError) {
						console.error(`[ERROR] Transaction error details:`, error.transactionError)
					}
					if (error.error) {
						console.error(`[ERROR] Nested error:`, error.error)
					}
					if (error.data) {
						console.error(`[ERROR] Error data:`, error.data)
					}

					// Проверяем конкретные коды ошибок
					if (error.code === -32603) {
						console.error(`[ERROR] RPC Internal Error (-32603) - possible causes:`, {
							'Account not found': 'Participant or escrow PDA does not exist',
							'Insufficient funds': 'Not enough SOL for transaction fee',
							'Invalid instruction': 'Smart contract instruction error',
							'Program error': 'Error in clearing-service program'
						})
					}

					toast.error(`Ошибка выполнения батча ${batchIndex}: ${error.message}`)
					return
				}
			}

			// 3. Подтверждаем выполненные комиссии в базе данных
			toast.info("Подтверждаем комиссии в базе данных...")
			console.log(`[DEBUG] Confirming fees in database:`, {
				sessionId: session_id,
				totalSignatures: feeSignatures.length,
				signatures: feeSignatures
			})

			await axios.post(`${API_URL}/api/blockchain/clearing/fees/confirm?admin_address=${publicKey.toBase58()}`, {
				session_id: session_id,
				fee_signatures: feeSignatures
			})

			console.log(`[DEBUG] Clearing completed successfully!`)
			toast.success(`Клиринг завершен! Выполнено ${fee_instructions.length} комиссий в ${totalBatches} батчах`)

			// Обновляем баланс escrow
			console.log(`[DEBUG] Refreshing escrow balance...`)
			loadEscrowBalance()

		} catch (error: any) {
			console.error('[ERROR] Clearing execution failed:', {
				error: error,
				message: error.message,
				response: error.response?.data,
				stack: error.stack
			})
			toast.error(error.response?.data?.error || 'Ошибка при проведении клиринга')
		} finally {
			setActionLoading(false)
			console.log(`[DEBUG] Clearing execution finished (with error or success)`)
		}
	}

	useEffect(() => {
		if (isAdmin) {
			loadAdmins()
			loadAllUsers()
			loadSystemSettings()
			loadWithdrawals()
			loadEscrowBalance()
		}
	}, [isAdmin])

	const loadAdmins = async () => {
		try {
			const response = await axios.get(`${API_URL}/api/admins`)
			if (response.data.success) {
				// Админы загружаются, но не сохраняются локально
				// Их можно получить из allUsers с фильтром по роли
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
				setSystemSettings(response.data.data)
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

	const loadEscrowBalance = async () => {
		try {
			const response = await axios.get(`${API_URL}/api/blockchain/escrow/balance?admin_address=${publicKey?.toBase58()}`)
			if (response.data.success) {
				setEscrowBalance(response.data.data)
			}
		} catch (error) {
			console.error('Error loading escrow balance:', error)
			toast.error('Ошибка при загрузке баланса escrow')
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


	const startEditingSettings = () => {
		if (systemSettings) {
			setEditingSettings({ ...systemSettings })
			setIsEditing(true)
		}
	}

	const cancelEditingSettings = () => {
		setEditingSettings({})
		setIsEditing(false)
	}

	const saveSystemSettings = async () => {
		try {
			setActionLoading(true)
			const response = await axios.post(`${API_URL}/api/system/settings?admin_address=${publicKey?.toBase58()}`, editingSettings)

			if (response.data.success) {
				toast.success('Настройки сохранены')
				setSystemSettings(response.data.data)
				setIsEditing(false)
				setEditingSettings({})
			} else {
				toast.error(response.data.error || 'Ошибка при сохранении настроек')
			}
		} catch (error: any) {
			console.error('Error saving settings:', error)
			const errorMessage = error.response?.data?.error || 'Ошибка при сохранении настроек'
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
					{/* Баланс escrow */}
					<div style={{ marginBottom: '32px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
							<h3 style={{ margin: 0 }}>💰 Баланс Escrow</h3>
							<button
								onClick={loadEscrowBalance}
								disabled={actionLoading}
								style={{
									padding: '6px 12px',
									background: actionLoading ? '#ccc' : '#667eea',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: actionLoading ? 'not-allowed' : 'pointer',
									fontSize: '12px'
								}}
							>
								{actionLoading ? 'Загрузка...' : 'Обновить'}
							</button>
						</div>
						{escrowBalance ? (
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
								<div style={{ padding: '12px', background: '#e8f5e8', borderRadius: '6px', border: '1px solid #4caf50' }}>
									<strong style={{ color: '#2e7d32' }}>Заблокированные средства:</strong>
									<div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2e7d32' }}>
										{(escrowBalance.total_locked / 1e9).toFixed(4)} SOL
									</div>
								</div>
								<div style={{ padding: '12px', background: '#fff3e0', borderRadius: '6px', border: '1px solid #ff9800' }}>
									<strong style={{ color: '#e65100' }}>Собранные комиссии:</strong>
									<div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e65100' }}>
										{(escrowBalance.system_fees_collected / 1e9).toFixed(4)} SOL
									</div>
								</div>
							</div>
						) : (
							<div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
								Загрузка баланса escrow...
							</div>
						)}
					</div>

					{/* Системные настройки */}
					<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<div style={{ padding: '20px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
								<h3 style={{ margin: 0 }}>Системные настройки</h3>
								{!isEditing && (
									<button
										onClick={startEditingSettings}
										style={{
											padding: '8px 16px',
											background: '#2196f3',
											color: 'white',
											border: 'none',
											borderRadius: '4px',
											cursor: 'pointer'
										}}
									>
										Редактировать настройки
									</button>
								)}
							</div>

							{loading ? (
								<div>Загрузка...</div>
							) : !systemSettings ? (
								<div style={{ textAlign: 'center', color: '#666', padding: '40px' }}>
									Ошибка загрузки настроек
								</div>
							) : isEditing ? (
								/* Форма редактирования */
								<div style={{ display: 'grid', gap: '24px' }}>
									{/* Правила клиринга */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 16px 0', color: '#1976d2' }}>📋 Правила клиринга</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Минимальное количество участников
												</label>
												<input
													type="number"
													value={editingSettings.clearing_min_participants || systemSettings.clearing_min_participants}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														clearing_min_participants: parseInt(e.target.value) || 2
													})}
													min="1"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Максимальная сумма (SOL)
												</label>
												<input
													type="number"
													value={(editingSettings.clearing_max_amount || systemSettings.clearing_max_amount) / 1e9}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														clearing_max_amount: Math.round(parseFloat(e.target.value) * 1e9) || 1000000
													})}
													min="0"
													step="0.01"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
										</div>
									</div>

									{/* Комиссии */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 16px 0', color: '#388e3c' }}>💰 Комиссии</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Клиринг (%)
												</label>
												<input
													type="number"
													value={((editingSettings.clearing_fee || systemSettings.clearing_fee) * 100)}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														clearing_fee: (parseFloat(e.target.value) || 0) / 100
													})}
													min="0"
													max="100"
													step="0.01"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Транзакция (SOL)
												</label>
												<input
													type="number"
													value={(editingSettings.transaction_fee || systemSettings.transaction_fee) * 1e9}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														transaction_fee: (parseFloat(e.target.value) || 0) / 1e9
													})}
													min="0"
													step="0.000001"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Депозит (%)
												</label>
												<input
													type="number"
													value={((editingSettings.deposit_fee || systemSettings.deposit_fee) * 100)}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														deposit_fee: (parseFloat(e.target.value) || 0) / 100
													})}
													min="0"
													max="100"
													step="0.01"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
										</div>
									</div>

									{/* Лимиты */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 16px 0', color: '#f57c00' }}>📊 Лимиты</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Дневной лимит транзакций (SOL)
												</label>
												<input
													type="number"
													value={(editingSettings.daily_transaction_limit || systemSettings.daily_transaction_limit) / 1e9}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														daily_transaction_limit: Math.round(parseFloat(e.target.value) * 1e9) || 10000
													})}
													min="0"
													step="0.01"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
											<div>
												<label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
													Месячный лимит объема (SOL)
												</label>
												<input
													type="number"
													value={(editingSettings.monthly_volume_limit || systemSettings.monthly_volume_limit) / 1e9}
													onChange={(e) => setEditingSettings({
														...editingSettings,
														monthly_volume_limit: Math.round(parseFloat(e.target.value) * 1e9) || 100000
													})}
													min="0"
													step="0.01"
													style={{
														width: '100%',
														padding: '8px 12px',
														border: '1px solid #ccc',
														borderRadius: '4px'
													}}
												/>
											</div>
										</div>
									</div>

									{/* Кнопки управления */}
									<div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid #e0e0e0' }}>
										<button
											onClick={cancelEditingSettings}
											style={{
												padding: '10px 20px',
												background: '#f44336',
												color: 'white',
												border: 'none',
												borderRadius: '4px',
												cursor: 'pointer'
											}}
										>
											Отмена
										</button>
										<button
											onClick={saveSystemSettings}
											disabled={actionLoading}
											style={{
												padding: '10px 20px',
												background: actionLoading ? '#ccc' : '#4caf50',
												color: 'white',
												border: 'none',
												borderRadius: '4px',
												cursor: actionLoading ? 'not-allowed' : 'pointer'
											}}
										>
											{actionLoading ? 'Сохранение...' : 'Сохранить настройки'}
										</button>
									</div>
								</div>
							) : (
								/* Отображение настроек */
								<div style={{ display: 'grid', gap: '16px' }}>
									{/* Правила клиринга */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 12px 0', color: '#1976d2' }}>📋 Правила клиринга</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
											<div>
												<strong>Мин. участников:</strong> {systemSettings.clearing_min_participants}
											</div>
											<div>
												<strong>Макс. сумма:</strong> {(systemSettings.clearing_max_amount / 1e9).toFixed(2)} SOL
											</div>
										</div>
									</div>

									{/* Комиссии */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 12px 0', color: '#388e3c' }}>💰 Комиссии</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
											<div>
												<strong>Клиринг:</strong> {(systemSettings.clearing_fee * 100).toFixed(2)}%
											</div>
											<div>
												<strong>Транзакция:</strong> {(systemSettings.transaction_fee * 1e9).toFixed(6)} SOL
											</div>
											<div>
												<strong>Депозит:</strong> {(systemSettings.deposit_fee * 100).toFixed(2)}%
											</div>
										</div>
									</div>

									{/* Лимиты */}
									<div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px' }}>
										<h4 style={{ margin: '0 0 12px 0', color: '#f57c00' }}>📊 Лимиты</h4>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
											<div>
												<strong>Дневной лимит:</strong> {(systemSettings.daily_transaction_limit / 1e9).toFixed(2)} SOL
											</div>
											<div>
												<strong>Месячный лимит:</strong> {(systemSettings.monthly_volume_limit / 1e9).toFixed(2)} SOL
											</div>
										</div>
									</div>

									{/* Информация об обновлении */}
									<div style={{ textAlign: 'right', color: '#666', fontSize: '12px', paddingTop: '8px' }}>
										Последнее обновление: {new Date(systemSettings.updated_at).toLocaleString()}
									</div>
								</div>
							)}
						</div>
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
							{actionLoading && (
								<div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
									Комиссии будут выполнены батчами по 10...
								</div>
							)}
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
