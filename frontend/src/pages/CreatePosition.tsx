import { useWallet } from '@solana/wallet-adapter-react'
import axios from 'axios'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { API_URL } from '../App'

export default function CreatePosition() {
	const { publicKey, signMessage } = useWallet()
	const navigate = useNavigate()
	const [counterparty, setCounterparty] = useState('')
	const [amount, setAmount] = useState('')
	const [loading, setLoading] = useState(false)

	function toBase64(bytes: Uint8Array) {
		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!publicKey) {
			toast.error('Пожалуйста, подключите кошелек')
			return
		}

		if (!counterparty || !amount) {
			toast.error('Заполните все поля')
			return
		}

		if (!signMessage) {
			toast.error('Ваш кошелёк не поддерживает подписание сообщений')
			return
		}

		try {
			setLoading(true)
			const amountLamports = parseFloat(amount) * 1e9

			const timestamp = Math.floor(Date.now() / 1000)

			const message =
				`counterparty:${counterparty};` +
				`amount:${amountLamports};` +
				`timestamp:${timestamp}`;

			const messageBytes = new TextEncoder().encode(message);
			const signature = await signMessage(messageBytes);

			const sig_b64 = toBase64(signature);

			await axios.post(`${API_URL}/api/positions`, {
				wallet: publicKey.toBase58(),
				payload: {
					counterparty,
					amount_lamports: amountLamports,
					timestamp
				},
				signature: sig_b64,
			});

			toast.success('Позиция создана успешно!')
			navigate('/positions')
		} catch (error: any) {
			console.error('Error creating position:', error)
			toast.error(error.response?.data?.error || 'Ошибка при создании позиции')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div>
			<div className="card">
				<h1 style={{ marginBottom: '24px', color: '#333' }}>Создать клиринговую позицию</h1>

				{!publicKey && (
					<div style={{
						padding: '16px',
						background: '#fff3cd',
						borderRadius: '8px',
						marginBottom: '24px',
						color: '#856404'
					}}>
						Пожалуйста, подключите кошелек для создания позиции
					</div>
				)}

				<form onSubmit={handleSubmit}>
					<label className="label">
						Адрес контрагента (Pubkey)
					</label>
					<input
						type="text"
						className="input"
						value={counterparty}
						onChange={(e) => setCounterparty(e.target.value)}
						placeholder="Введите адрес Solana кошелька контрагента"
						required
					/>

					<label className="label">
						Сумма (SOL)
					</label>
					<input
						type="number"
						step="0.000000001"
						className="input"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						placeholder="0.0"
						required
						min="0"
					/>

					<button
						type="submit"
						className="btn btn-primary"
						disabled={loading || !publicKey}
						style={{ width: '100%' }}
					>
						{loading ? 'Создание...' : 'Создать позицию'}
					</button>
				</form>
			</div>
		</div>
	)
}






