import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, SystemProgram, Transaction, PublicKey } from '@solana/web3.js'
import { toast } from 'react-toastify'
import { RPC_URL } from '../main'
import { getBiilsByParticipant, useProgram } from '../api'

export default function Bills() {
    const { publicKey, sendTransaction } = useWallet()
    const program = useProgram()
    const [settlements, setSettlements] = useState([])

    useEffect(() => {
        load()
    }, [publicKey])

    const load = async () => {
        if (!publicKey || !program)
            return

        const bills = await getBiilsByParticipant(program, publicKey)

        console.log(bills)

        setSettlements(bills)
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
