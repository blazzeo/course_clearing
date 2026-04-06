import { useWallet } from '@solana/wallet-adapter-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { getPool, getPoolPda, registerObligation, useProgram } from '../api'
import { PublicKey } from '@solana/web3.js'

export default function CreateObligation() {
    const { publicKey } = useWallet()
    const program = useProgram()
    const navigate = useNavigate()
    const [counterparty, setCounterparty] = useState('')
    const [amount, setAmount] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        if (!counterparty || !amount) {
            toast.error('Заполните все поля')
            return
        }

        // TODO: Fix this
        try {
            setLoading(true)
            const amountLamports = parseFloat(amount) * 1e9

            const timestamp = Math.floor(Date.now() / 1000)

            const counterPartyPubkey = new PublicKey(counterparty)

            let pool_id = 0;
            let free_pool_found = false
            let new_pool_found = false

            // loop until we find free pool
            // or fetch pools until we find free pool
            while (!free_pool_found && !new_pool_found) {
                const pool_pda = getPoolPda(program, pool_id);

                const pool = await getPool(program, pool_pda);

                //	Free pool found
                if (pool && pool?.occupiedCount < 50) {
                    free_pool_found = true
                    break
                }

                //	No pool found -> Need to create new pool
                if (!pool) {
                    free_pool_found = true
                    break
                }

                pool_id++

                if (pool_id > 10) {
                    throw new Error('Не удалось найти свободный пул')
                }

                console.log("checking pool", pool_id)
            }

            const tx = await registerObligation(program, counterPartyPubkey, publicKey, amountLamports, pool_id, timestamp);

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Позиция создана успешно!')
            navigate('/obligations')
        } catch (error: any) {
            console.error('Error creating obligation:', error)
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






