import { useEffect, useState } from 'react'
import axios from 'axios'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, SystemProgram, Transaction, PublicKey } from '@solana/web3.js'
import { toast } from 'react-toastify'
import { API_URL, RPC_URL } from '../App'

export default function Bills() {
	const { publicKey, sendTransaction } = useWallet()
	const [settlements, setSettlements] = useState([])
	const [participantStatus, setParticipantStatus] = useState<{
		address: string,
		balance: number,
		outstanding_fees: number,
		is_blocked: boolean,
		total_debt: number
	} | null>(null)
	const [escrowPda, setEscrowPda] = useState<string | null>(null)
	const [feeRates, setFeeRates] = useState<{
		clearing_fee: number,
		transaction_fee: number,
		deposit_fee: number,
		withdrawal_fee: number,
	} | null>(null)

	useEffect(() => {
		load()
	}, [publicKey])

	const load = async () => {
		if (!publicKey) return
		const res = await axios.get(`${API_URL}/api/settlements?pbkey=${publicKey}`)
		if (res.data.success) setSettlements(res.data.data)
	}

	const pay = async (s: any) => {
		if (!publicKey) return toast.error("Connect wallet")

		const conn = new Connection(RPC_URL)

		const ix = SystemProgram.transfer({
			fromPubkey: publicKey,
			toPubkey: new PublicKey(s.to_address),
			lamports: Number(s.amount),
		})

		const tx = new Transaction().add(ix)

		const sig = await sendTransaction(tx, conn)

		await axios.post(`${API_URL}/api/settlements/${s.id}/pay`, {
			tx_signature: sig
		})

		toast.success("Оплачено!")
		load()
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
						{settlements.map((s: any) => (
							<tr key={s.id}>
								<td>{s.from_address.slice(0, 8)}...</td>
								<td>{s.to_address.slice(0, 8)}...</td>
								<td>{s.amount / 1e9} SOL</td>
								<td>{s.tx_signature ? "Оплачено" : "Не оплачено"}</td>
								<td>
									{s.from_address === publicKey.toString() && !s.tx_signature && (
										<button className="btn btn-primary" onClick={() => pay(s)}>
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
