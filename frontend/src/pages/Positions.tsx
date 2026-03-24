import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useWallet } from '@solana/wallet-adapter-react'
import { cancelObligation, confirmObligation, getObligationsByParticipant, useProgram } from '../api'
import { PublicKey } from '@solana/web3.js'

interface Obligation {
    status: any;
    from: PublicKey;
    to: PublicKey;
    amount: number;
    timestamp: number;
    sessionId: any;
    fromCancel: boolean;
    toCancel: boolean;
    poolId: number;
    bump: number;
}

export default function Positions() {
    const [positions, setPositions] = useState<Obligation[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<string>('all')
    const [actionLoading, setActionLoading] = useState<Obligation | null>(null)

    const { publicKey } = useWallet()
    const program = useProgram()

    useEffect(() => {
        loadPositions()
    }, [filter, publicKey])

    const loadPositions = async () => {
        if (!publicKey || !program) {
            return
        }

        try {
            setLoading(true)

            const obligations = await getObligationsByParticipant(program, publicKey)

            setPositions(obligations)

        } catch (error) {
            console.error('Error loading positions:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (obligation: Obligation) => {
        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        if (!confirm('Вы уверены, что хотите отменить эту позицию?')) {
            return
        }

        try {
            setActionLoading(obligation)

            const tx = await cancelObligation(program, obligation.from, obligation.to, obligation.timestamp);

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Позиция успешно отклонена!')
            loadPositions()
        } catch (error: any) {
            console.error('Error cancelling position:', error)
            const errorMessage = error.response?.data?.error || 'Ошибка при отмене позиции'
            toast.error(errorMessage)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDecline = async (obligation: Obligation) => {
        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        if (!confirm('Вы уверены, что хотите отклонить эту позицию?')) {
            return
        }

        try {
            setActionLoading(obligation)

            const tx = await cancelObligation(program, obligation.from, obligation.to, obligation.timestamp);

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Позиция успешно отклонена!')
            loadPositions()
        } catch (error: any) {
            console.error('Error declining position:', error)
            const errorMessage = error.response?.data?.error || 'Ошибка при отмене позиции'
            toast.error(errorMessage)
        } finally {
            setActionLoading(null)
        }
    }

    const handleConfirm = async (obligation: Obligation) => {
        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        try {
            const tx = await confirmObligation(program, obligation.from, obligation.to, obligation.timestamp)

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Позиция подтверждена успешно!')
            loadPositions()
        } catch (error) {
            console.error('Error confirming position:', error)
            toast.error('Ошибка при подтверждении позиции')
        }
    }

    const getStatusClass = (status: string) => {
        switch (status) {
            case 'pending':
                return 'status-badge status-pending'
            case 'confirmed':
                return 'status-badge status-confirmed'
            case 'cleared':
                return 'status-badge status-cleared'
            default:
                return 'status-badge'
        }
    }

    const formatDate = (dateString: string | null) => {
        if (!dateString) return '-'
        return new Date(dateString).toLocaleString('ru-RU')
    }

    // Если кошелёк не подключён — возвращаем пустую страницу
    if (!publicKey) {
        return <h1 style={{ color: '#eee' }}>Доступно только авторизованным пользователям</h1>
    }

    return (
        <div>
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h1 style={{ color: '#333' }}>Клиринговые позиции</h1>
                    <Link to="/positions/create" className="btn btn-primary">
                        Создать позицию
                    </Link>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Фильтр по статусу:</label>
                    <select
                        className="input"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={{ width: 'auto', display: 'inline-block', marginLeft: '8px' }}
                    >
                        <option value="all">Все</option>
                        <option value="pending">Ожидают подтверждения</option>
                        <option value="confirmed">Подтверждены</option>
                        <option value="cleared">Выполнены</option>
                    </select>
                </div>

                {loading ? (
                    <p>Загрузка...</p>
                ) : positions.length === 0 ? (
                    <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
                        Позиции не найдены
                    </p>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Создатель</th>
                                <th>Контрагент</th>
                                <th>Сумма</th>
                                <th>Статус</th>
                                <th>Создано</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((position) => (
                                <tr key={position.timestamp}>
                                    <td>
                                        <Link to={`/participant/${position.from}`} style={{ color: '#667eea' }}>
                                            {position.from.toBase58().slice(0, 8)}...
                                        </Link>
                                    </td>
                                    <td>
                                        <Link to={`/participant/${position.to}`} style={{ color: '#667eea' }}>
                                            {position.to.toBase58().slice(0, 8)}...
                                        </Link>
                                    </td>
                                    <td>{position.amount / 1e9} SOL</td>
                                    <td>
                                        <span className={getStatusClass(position.status)}>
                                            {position.status === 'pending' && 'Без подтверждения'}
                                            {position.status === 'confirmed' && 'Подтверждена'}
                                            {position.status === 'cleared' && 'Выполнена'}
                                        </span>
                                    </td>
                                    <td>{formatDate(position.timestamp.toString())}</td>
                                    <td>
                                        {position.status === 'pending' && position.to === publicKey && (
                                            <button
                                                className="btn btn-primary"
                                                style={{ padding: '6px 12px', fontSize: '14px' }}
                                                onClick={() => handleConfirm(position)}
                                                disabled={actionLoading === position}
                                            >
                                                {actionLoading === position ? 'Подтверждение...' : 'Подтвердить'}
                                            </button>
                                        )}
                                        {position.status === 'pending' && position.from === publicKey && (
                                            <button
                                                className="btn btn-danger"
                                                style={{ padding: '6px 12px', fontSize: '14px', marginLeft: '8px' }}
                                                onClick={() => handleDelete(position)}
                                                disabled={actionLoading === position}
                                            >
                                                {actionLoading === position ? 'Отмена...' : 'Отменить'}
                                            </button>
                                        )}
                                        {position.status === 'confirmed' && (
                                            <span style={{ color: '#666' }}>На обработке</span>
                                        )}
                                        {position.status === 'cleared' && (
                                            <span style={{ color: '#666' }}>Завершено</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}






