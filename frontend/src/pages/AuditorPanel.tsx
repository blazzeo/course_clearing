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

	// Pagination states
	const [currentPage, setCurrentPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)

	// Filter states
	const [userTypeFilter, setUserTypeFilter] = useState('')
	const [addressFilter, setAddressFilter] = useState('')

	// Sort states
	const [sortField, setSortField] = useState<'balance' | 'updated_at' | 'user_type'>('updated_at')
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

	// Logs filter and pagination states
	const [logsCurrentPage, setLogsCurrentPage] = useState(1)
	const [logsPageSize, setLogsPageSize] = useState(10)
	const [logsUserFilter, setLogsUserFilter] = useState('')
	const [logsActionFilter, setLogsActionFilter] = useState('')
	const [logsResourceTypeFilter, setLogsResourceTypeFilter] = useState('')
	const [logsDateFromFilter, setLogsDateFromFilter] = useState('')
	const [logsDateToFilter, setLogsDateToFilter] = useState('')

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

	// Filter and sort balances
	const getFilteredAndSortedBalances = () => {
		let filtered = balances.filter(balance => {
			const matchesUserType = !userTypeFilter || balance.user_type.toLowerCase().includes(userTypeFilter.toLowerCase())
			const matchesAddress = !addressFilter || balance.address.toLowerCase().includes(addressFilter.toLowerCase())
			return matchesUserType && matchesAddress
		})

		// Sort
		filtered.sort((a, b) => {
			let aValue: any, bValue: any

			switch (sortField) {
				case 'balance':
					aValue = a.balance
					bValue = b.balance
					break
				case 'updated_at':
					aValue = new Date(a.updated_at).getTime()
					bValue = new Date(b.updated_at).getTime()
					break
				case 'user_type':
					aValue = a.user_type.toLowerCase()
					bValue = b.user_type.toLowerCase()
					break
				default:
					return 0
			}

			if (sortDirection === 'asc') {
				return aValue > bValue ? 1 : -1
			} else {
				return aValue < bValue ? 1 : -1
			}
		})

		return filtered
	}

	// Reset pagination when filters change
	const resetPagination = () => {
		setCurrentPage(1)
	}

	// Handle filter changes
	const handleUserTypeFilterChange = (value: string) => {
		setUserTypeFilter(value)
		resetPagination()
	}

	const handleAddressFilterChange = (value: string) => {
		setAddressFilter(value)
		resetPagination()
	}

	// Handle sort
	const handleSort = (field: 'balance' | 'updated_at' | 'user_type') => {
		if (sortField === field) {
			setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
		} else {
			setSortField(field)
			setSortDirection('asc')
		}
		resetPagination()
	}

	// Get paginated data
	const getPaginatedBalances = () => {
		const filtered = getFilteredAndSortedBalances()
		const startIndex = (currentPage - 1) * pageSize
		const endIndex = startIndex + pageSize
		return filtered.slice(startIndex, endIndex)
	}

	const totalPages = Math.ceil(getFilteredAndSortedBalances().length / pageSize)

	// Filter and sort logs
	const getFilteredAndSortedLogs = () => {
		let filtered = auditLogs.filter(log => {
			const matchesUser = !logsUserFilter || log.user_address.toLowerCase().includes(logsUserFilter.toLowerCase())
			const matchesAction = !logsActionFilter || log.action.toLowerCase().includes(logsActionFilter.toLowerCase())
			const matchesResourceType = !logsResourceTypeFilter || log.resource_type.toLowerCase().includes(logsResourceTypeFilter.toLowerCase())

			let matchesDateRange = true
			if (logsDateFromFilter || logsDateToFilter) {
				const logDate = new Date(log.created_at)
				if (logsDateFromFilter) {
					const fromDate = new Date(logsDateFromFilter)
					matchesDateRange = matchesDateRange && logDate >= fromDate
				}
				if (logsDateToFilter) {
					const toDate = new Date(logsDateToFilter)
					toDate.setHours(23, 59, 59, 999) // Include the entire day
					matchesDateRange = matchesDateRange && logDate <= toDate
				}
			}

			return matchesUser && matchesAction && matchesResourceType && matchesDateRange
		})

		// Sort by created_at descending (newest first)
		filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

		return filtered
	}

	// Reset logs pagination when filters change
	const resetLogsPagination = () => {
		setLogsCurrentPage(1)
	}

	// Handle logs filter changes
	const handleLogsUserFilterChange = (value: string) => {
		setLogsUserFilter(value)
		resetLogsPagination()
	}

	const handleLogsActionFilterChange = (value: string) => {
		setLogsActionFilter(value)
		resetLogsPagination()
	}

	const handleLogsResourceTypeFilterChange = (value: string) => {
		setLogsResourceTypeFilter(value)
		resetLogsPagination()
	}

	const handleLogsDateFromFilterChange = (value: string) => {
		setLogsDateFromFilter(value)
		resetLogsPagination()
	}

	const handleLogsDateToFilterChange = (value: string) => {
		setLogsDateToFilter(value)
		resetLogsPagination()
	}

	// Get paginated logs
	const getPaginatedLogs = () => {
		const filtered = getFilteredAndSortedLogs()
		const startIndex = (logsCurrentPage - 1) * logsPageSize
		const endIndex = startIndex + logsPageSize
		return filtered.slice(startIndex, endIndex)
	}

	const logsTotalPages = Math.ceil(getFilteredAndSortedLogs().length / logsPageSize)

	return (
		<div style={{ maxWidth: '1200px', margin: '0 auto' }}>
			<h1 style={{ color: 'white' }}>Панель аудитора</h1>

			{/* Tab Navigation */}
			<div style={{ marginBottom: '20px' }}>
				<button
					onClick={() => setActiveTab('logs')}
					style={{
						padding: '10px 20px',
						marginRight: '10px',
						backgroundColor: activeTab === 'logs' ? '#4CAF50' : '#333',
						color: 'white',
						border: 'none',
						borderRadius: '5px',
						cursor: 'pointer'
					}}
				>
					Логи аудита
				</button>
				<button
					onClick={() => setActiveTab('balances')}
					style={{
						padding: '10px 20px',
						backgroundColor: activeTab === 'balances' ? '#4CAF50' : '#333',
						color: 'white',
						border: 'none',
						borderRadius: '5px',
						cursor: 'pointer'
					}}
				>
					Балансы
				</button>
			</div>

			{/* Audit Logs Tab */}
			{activeTab === 'logs' && (
				<div>
					<h2 style={{ color: 'white', margin: '15px 0' }}>История действий пользователей</h2>

					{/* Logs Filters Panel */}
					<div style={{ background: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'end' }}>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '200px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Фильтр по пользователю:</label>
								<input
									type="text"
									value={logsUserFilter}
									onChange={(e) => handleLogsUserFilterChange(e.target.value)}
									placeholder="Введите адрес пользователя..."
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '180px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Фильтр по действию:</label>
								<input
									type="text"
									value={logsActionFilter}
									onChange={(e) => handleLogsActionFilterChange(e.target.value)}
									placeholder="Введите действие..."
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '180px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Фильтр по типу ресурса:</label>
								<input
									type="text"
									value={logsResourceTypeFilter}
									onChange={(e) => handleLogsResourceTypeFilterChange(e.target.value)}
									placeholder="Введите тип ресурса..."
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Дата от:</label>
								<input
									type="date"
									value={logsDateFromFilter}
									onChange={(e) => handleLogsDateFromFilterChange(e.target.value)}
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Дата до:</label>
								<input
									type="date"
									value={logsDateToFilter}
									onChange={(e) => handleLogsDateToFilterChange(e.target.value)}
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Записей на странице:</label>
								<select
									value={logsPageSize}
									onChange={(e) => {
										setLogsPageSize(Number(e.target.value))
										setLogsCurrentPage(1)
									}}
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								>
									<option value={5}>5</option>
									<option value={10}>10</option>
									<option value={25}>25</option>
									<option value={50}>50</option>
								</select>
							</div>
							<div style={{ display: 'flex', alignItems: 'end' }}>
								<button
									onClick={() => {
										setLogsUserFilter('')
										setLogsActionFilter('')
										setLogsResourceTypeFilter('')
										setLogsDateFromFilter('')
										setLogsDateToFilter('')
										setLogsCurrentPage(1)
									}}
									style={{
										padding: '8px 16px',
										backgroundColor: '#ff6b6b',
										color: 'white',
										border: 'none',
										borderRadius: '4px',
										cursor: 'pointer',
										fontSize: '14px'
									}}
								>
									Очистить фильтры
								</button>
							</div>
						</div>
					</div>

					{loadingLogs ? (
						<div>Загрузка логов...</div>
					) : (
						<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
							{getFilteredAndSortedLogs().length === 0 ? (
								<div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
									{auditLogs.length === 0 ? 'Логи аудита отсутствуют' : 'Нет логов, соответствующих фильтрам'}
								</div>
							) : (
								<div>
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
												{getPaginatedLogs().map((log) => (
													<tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
														<td style={{ padding: '12px' }}>{formatDate(log.created_at)}</td>
														<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
															{formatAddress(log.user_address)}
														</td>
														<td style={{ padding: '12px' }}>{log.action}</td>
														<td style={{ padding: '12px' }}>{log.resource_type}</td>
														<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
															{log.resource_id ?
																(log.resource_id.length > 20) ?
																	formatAddress(log.resource_id) :
																	log.resource_id
																: '-'
															}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>

									{/* Logs Pagination */}
									{logsTotalPages > 1 && (
										<div style={{
											padding: '20px',
											borderTop: '1px solid #eee',
											display: 'flex',
											justifyContent: 'center',
											alignItems: 'center',
											gap: '10px'
										}}>
											<button
												onClick={() => setLogsCurrentPage(Math.max(1, logsCurrentPage - 1))}
												disabled={logsCurrentPage === 1}
												style={{
													padding: '8px 16px',
													backgroundColor: logsCurrentPage === 1 ? '#ccc' : '#4CAF50',
													color: 'white',
													border: 'none',
													borderRadius: '4px',
													cursor: logsCurrentPage === 1 ? 'not-allowed' : 'pointer'
												}}
											>
												Предыдущая
											</button>

											<span style={{ margin: '0 10px', fontWeight: 'bold' }}>
												Страница {logsCurrentPage} из {logsTotalPages}
												(Всего записей: {getFilteredAndSortedLogs().length})
											</span>

											<button
												onClick={() => setLogsCurrentPage(Math.min(logsTotalPages, logsCurrentPage + 1))}
												disabled={logsCurrentPage === logsTotalPages}
												style={{
													padding: '8px 16px',
													backgroundColor: logsCurrentPage === logsTotalPages ? '#ccc' : '#4CAF50',
													color: 'white',
													border: 'none',
													borderRadius: '4px',
													cursor: logsCurrentPage === logsTotalPages ? 'not-allowed' : 'pointer'
												}}
											>
												Следующая
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Balances Tab */}
			{activeTab === 'balances' && (
				<div>
					<h2 style={{ color: 'white', margin: '15px 0' }}>Балансы пользователей</h2>

					{/* Filters Panel */}
					<div style={{ background: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
						<div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '200px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Фильтр по типу пользователя:</label>
								<input
									type="text"
									value={userTypeFilter}
									onChange={(e) => handleUserTypeFilterChange(e.target.value)}
									placeholder="Введите тип пользователя..."
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '200px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Фильтр по адресу:</label>
								<input
									type="text"
									value={addressFilter}
									onChange={(e) => handleAddressFilterChange(e.target.value)}
									placeholder="Введите адрес..."
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								/>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
								<label style={{ marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>Записей на странице:</label>
								<select
									value={pageSize}
									onChange={(e) => {
										setPageSize(Number(e.target.value))
										setCurrentPage(1)
									}}
									style={{
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
										fontSize: '14px'
									}}
								>
									<option value={5}>5</option>
									<option value={10}>10</option>
									<option value={25}>25</option>
									<option value={50}>50</option>
								</select>
							</div>
							<div style={{ display: 'flex', alignItems: 'end' }}>
								<button
									onClick={() => {
										setUserTypeFilter('')
										setAddressFilter('')
										setCurrentPage(1)
									}}
									style={{
										padding: '8px 16px',
										backgroundColor: '#ff6b6b',
										color: 'white',
										border: 'none',
										borderRadius: '4px',
										cursor: 'pointer',
										fontSize: '14px'
									}}
								>
									Очистить фильтры
								</button>
							</div>
						</div>
					</div>

					{loadingBalances ? (
						<div>Загрузка балансов...</div>
					) : (
						<div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
							{getFilteredAndSortedBalances().length === 0 ? (
								<div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
									{balances.length === 0 ? 'Балансы отсутствуют' : 'Нет балансов, соответствующих фильтрам'}
								</div>
							) : (
								<div>
									<div style={{ overflowX: 'auto' }}>
										<table style={{ width: '100%', borderCollapse: 'collapse' }}>
											<thead>
												<tr style={{ background: '#f5f5f5' }}>
													<th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Адрес пользователя</th>
													<th
														style={{
															padding: '12px',
															textAlign: 'left',
															borderBottom: '1px solid #ddd',
															cursor: 'pointer',
															userSelect: 'none'
														}}
														onClick={() => handleSort('balance')}
													>
														Баланс (SOL) {sortField === 'balance' && (sortDirection === 'asc' ? '↑' : '↓')}
													</th>
													<th
														style={{
															padding: '12px',
															textAlign: 'left',
															borderBottom: '1px solid #ddd',
															cursor: 'pointer',
															userSelect: 'none'
														}}
														onClick={() => handleSort('user_type')}
													>
														Тип пользователя {sortField === 'user_type' && (sortDirection === 'asc' ? '↑' : '↓')}
													</th>
													<th
														style={{
															padding: '12px',
															textAlign: 'left',
															borderBottom: '1px solid #ddd',
															cursor: 'pointer',
															userSelect: 'none'
														}}
														onClick={() => handleSort('updated_at')}
													>
														Последнее обновление {sortField === 'updated_at' && (sortDirection === 'asc' ? '↑' : '↓')}
													</th>
												</tr>
											</thead>
											<tbody>
												{getPaginatedBalances().map((balance, index) => (
													<tr key={index} style={{ borderBottom: '1px solid #eee' }}>
														<td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
															{formatAddress(balance.address)}
														</td>
														<td style={{ padding: '12px', fontWeight: 'bold' }}>
															{(balance.balance / 1e9).toFixed(4)} SOL
														</td>
														<td style={{ padding: '12px' }}>{balance.user_type}</td>
														<td style={{ padding: '12px' }}>{formatDate(balance.updated_at)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>

									{/* Pagination */}
									{totalPages > 1 && (
										<div style={{
											padding: '20px',
											borderTop: '1px solid #eee',
											display: 'flex',
											justifyContent: 'center',
											alignItems: 'center',
											gap: '10px'
										}}>
											<button
												onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
												disabled={currentPage === 1}
												style={{
													padding: '8px 16px',
													backgroundColor: currentPage === 1 ? '#ccc' : '#4CAF50',
													color: 'white',
													border: 'none',
													borderRadius: '4px',
													cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
												}}
											>
												Предыдущая
											</button>

											<span style={{ margin: '0 10px', fontWeight: 'bold' }}>
												Страница {currentPage} из {totalPages}
												(Всего записей: {getFilteredAndSortedBalances().length})
											</span>

											<button
												onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
												disabled={currentPage === totalPages}
												style={{
													padding: '8px 16px',
													backgroundColor: currentPage === totalPages ? '#ccc' : '#4CAF50',
													color: 'white',
													border: 'none',
													borderRadius: '4px',
													cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
												}}
											>
												Следующая
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			)}

		</div>
	)
}








