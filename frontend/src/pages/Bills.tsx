import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { getBillsByParticipant, payFee, settle_position, useProgram } from '../api'
import { Bill } from '../interfaces'

export default function Bills() {
	const { publicKey } = useWallet()
	const program = useProgram()
	const [settlements, setSettlements] = useState<Bill[]>([])
	const [processingBill, setProcessingBill] = useState<string | null>(null)

	useEffect(() => {
		load()
	}, [publicKey])

	const load = async () => {
		if (!publicKey || !program)
			return

		const bills = await getBillsByParticipant(program, publicKey)

		console.log(bills)

		setSettlements(bills)
	}

	const payCommission = async (s: Bill) => {
		if (!publicKey || !program) return toast.error("Connect wallet")

		try {
			setProcessingBill(s.pda.toBase58())
			await payFee(program, s.session_id, s.creditor)
			toast.success("Комиссия оплачена")
			await load()
		} catch (error) {
			console.error(error)
			toast.error("Ошибка при оплате комиссии")
		} finally {
			setProcessingBill(null)
		}
	}

	const pay = async (s: Bill) => {
		if (!publicKey || !program) return toast.error("Connect wallet")

		try {
			setProcessingBill(s.pda.toBase58())
			await settle_position(program, s.session_id, s.creditor, s.net_amount)

			toast.success("Позиция погашена через программу")
			await load()
		} catch (error) {
			console.error(error)
			toast.error("Ошибка при on-chain погашении позиции")
		} finally {
			setProcessingBill(null)
		}
	}

	if (!publicKey)
		return <h1 style={{ color: '#eee' }}>Подключите кошелёк</h1>

	return (
		<div className="card">
			<h1>Мои счета</h1>

			{settlements.length === 0 ? (
				<p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
					Счета не найдены
				</p>
			) : (
				<table className="table">
					<thead>
						<tr>
							<th>От</th>
							<th>Кому</th>
							<th>Сумма</th>
							<th>Подтверждение</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{settlements.map((s) => (
							<tr key={s.pda.toBase58()}>
								<td>{s.debitor.toBase58().slice(0, 8)}...</td>
								<td>{s.creditor.toBase58().slice(0, 8)}...</td>
								<td>{s.net_amount / 1e9} SOL</td>
								<td>{s.status === 2 ? "Оплачено" : "Не оплачено"}</td>
								<td>
									{s.debitor.equals(publicKey) && s.status === 0 && s.fee_amount > 0 && (
										<button
											className="btn btn-secondary"
											onClick={() => payCommission(s)}
											disabled={processingBill === s.pda.toBase58()}
										>
											Оплатить комиссию
										</button>
									)}
									{s.debitor.equals(publicKey) && (s.status === 1 || (s.status === 0 && s.fee_amount === 0)) && (
										<button
											className="btn btn-primary"
											onClick={() => pay(s)}
											disabled={processingBill === s.pda.toBase58()}
										>
											Оплатить
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)
			}
		</div>
	)
}
