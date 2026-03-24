import { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { getBalance } from '../api'

export default function Funds() {
    const { publicKey } = useWallet()
    const { connection } = useConnection()
    const [balance, setBalance] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (publicKey) {
            loadBalance()
        }
    }, [publicKey])

    const loadBalance = async () => {
        if (!publicKey) return

        try {
            setLoading(true)
            const balance = await getBalance(connection, publicKey)
            if (balance) {
                setBalance(balance)
            }
        } catch (error) {
            console.error('Error loading balance:', error)
            toast.error('Ошибка загрузки баланса')
        } finally {
            setLoading(false)
        }
    }

    if (!publicKey) {
        return <div className="card">Подключите кошелек для управления средствами</div>
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1>Управление средствами</h1>

            {/* Баланс */}
            <div className="card" style={{ marginBottom: '24px' }}>
                <h2 style={{ marginBottom: '16px' }}>Баланс</h2>
                {loading ? (
                    <div>Загрузка...</div>
                ) : balance ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div style={{ padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4caf50' }}>
                                {(balance / 1e9).toFixed(4)} SOL
                            </div>
                            <div style={{ color: '#666' }}>Баланс кошелька</div>
                        </div>
                    </div>
                ) : (
                    <div>Не удалось загрузить баланс</div>
                )}
            </div>

        </div>
    )
}
