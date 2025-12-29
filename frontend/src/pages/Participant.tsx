import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'

interface ParticipantData {
	id: number,
	address: string,
	user_type: string,
	created_at: number
}

const getRoleDisplayName = (role: string) => {
	switch (role) {
		case 'guest': return 'Гость'
		case 'counterparty': return 'Контрагент'
		case 'auditor': return 'Аудитор'
		case 'administrator': return 'Администратор'
		default: return 'Неизвестно'
	}
}

const formatDate = (timestamp: number | string) => {
	// Handle both numeric timestamps (seconds) and ISO strings
	let date: Date
	if (typeof timestamp === 'string') {
		date = new Date(timestamp)
	} else {
		date = new Date(timestamp * 1000)
	}

	// Check if date is valid
	if (isNaN(date.getTime())) {
		return 'Некорректная дата'
	}

	return date.toLocaleString('ru-RU', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	})
}

const copyToClipboard = async (text: string) => {
	try {
		await navigator.clipboard.writeText(text)
		toast.success('Адрес скопирован в буфер обмена')
	} catch (err) {
		toast.error('Не удалось скопировать адрес')
	}
}

export default function Participant() {
	const { address } = useParams<{ address: string }>()
	const [participant, setParticipant] = useState<ParticipantData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (address) {
			loadParticipant()
		}
	}, [address])

	const loadParticipant = async () => {
		try {
			setLoading(true)
			setError(null)
			const response = await axios.get(`${API_URL}/api/participants/${address}`)
			if (response.data.success) {
				setParticipant(response.data.data)
			} else {
				setError('Не удалось загрузить данные участника')
			}
		} catch (error: any) {
			console.error('Error loading participant:', error)
			if (error.response?.status === 404) {
				setError('Участник не найден')
			} else if (error.response?.status === 500) {
				setError('Ошибка сервера')
			} else {
				setError('Не удалось загрузить данные участника')
			}
		} finally {
			setLoading(false)
		}
	}

	if (loading) {
		return (
			<div className="card">
				<div style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '200px',
					flexDirection: 'column',
					gap: '16px'
				}}>
					<div style={{
						width: '40px',
						height: '40px',
						border: '4px solid #f3f3f3',
						borderTop: '4px solid #667eea',
						borderRadius: '50%',
						animation: 'spin 1s linear infinite'
					}}></div>
					<p style={{ color: '#666', fontSize: '16px' }}>Загрузка информации об участнике...</p>
				</div>
				<style>{`
					@keyframes spin {
						0% { transform: rotate(0deg); }
						100% { transform: rotate(360deg); }
					}
				`}</style>
			</div>
		)
	}

	if (error || !participant) {
		return (
			<div className="card">
				<div style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '200px',
					flexDirection: 'column',
					gap: '16px'
				}}>
					<div style={{
						fontSize: '48px',
						color: '#dc3545'
					}}>⚠️</div>
					<h2 style={{ color: '#dc3545', margin: '0' }}>Ошибка</h2>
					<p style={{
						color: '#666',
						textAlign: 'center',
						margin: '0',
						maxWidth: '400px'
					}}>
						{error || 'Участник не найден'}
					</p>
				</div>
			</div>
		)
	}

	return (
		<div>
			<div className="card">
				<div style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					marginBottom: '24px'
				}}>
					<h1 style={{ margin: '0', color: '#333' }}>Информация об участнике</h1>
					<div style={{
						padding: '4px 12px',
						background: '#28a745',
						color: 'white',
						borderRadius: '20px',
						fontSize: '14px',
						fontWeight: '600'
					}}>
						Активен
					</div>
				</div>

				<div style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
					gap: '20px',
					marginBottom: '24px'
				}}>

					<div>
						<label className="label">Тип аккаунта:</label>
						<p style={{
							padding: '12px',
							background: '#f8f9fa',
							borderRadius: '8px',
							fontSize: '16px',
							fontWeight: '600',
							color: '#495057',
							margin: '0'
						}}>
							{getRoleDisplayName(participant.user_type)}
						</p>
					</div>
				</div>

				<div style={{ marginBottom: '20px' }}>
					<label className="label">Адрес кошелька:</label>
					<div style={{
						display: 'flex',
						gap: '12px',
						alignItems: 'center'
					}}>
						<p style={{
							flex: 1,
							padding: '12px',
							background: '#f8f9fa',
							borderRadius: '8px',
							fontFamily: 'monospace',
							fontSize: '14px',
							wordBreak: 'break-all',
							margin: '0',
							border: '1px solid #dee2e6'
						}}>
							{participant.address}
						</p>
						<button
							onClick={() => copyToClipboard(participant.address)}
							className="btn btn-primary"
							style={{
								padding: '12px 16px',
								minWidth: 'auto',
								fontSize: '14px'
							}}
							title="Копировать адрес"
						>
							📋
						</button>
					</div>
				</div>

				<div>
					<label className="label">Дата регистрации:</label>
					<p style={{
						padding: '12px',
						background: '#f8f9fa',
						borderRadius: '8px',
						fontSize: '16px',
						fontWeight: '500',
						color: '#495057',
						margin: '0',
						border: '1px solid #dee2e6'
					}}>
						{formatDate(participant.created_at)}
					</p>
				</div>

			</div>
		</div>
	)
}






