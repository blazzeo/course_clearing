import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useWallet } from '@solana/wallet-adapter-react'
import { cancelObligation, confirmObligation, declineObligation, getLastClearingAudit, getObligationsByParticipantFromDb, getObligationsByParticipantFromPools, useProgram } from '../api'
import { ClearingAuditResult, Obligation, ObligationStatus } from '../interfaces'
import { ClipLoader } from "react-spinners";
import { API_URL } from '../main'

export function MapObligationStatus(status: ObligationStatus) {
    switch (status) {
        case ObligationStatus.All: return "All";
        case ObligationStatus.Created: return "Created";
        case ObligationStatus.Confirmed: return "В процессе";
        case ObligationStatus.PartiallyNetted: return "PartiallyNetted";
        case ObligationStatus.Declined: return "Declined";
        case ObligationStatus.Netted: return "Netted";
        case ObligationStatus.Cancelled: return "Cancelled";
    }
}

export default function ObligationsPage() {
    const [allObligations, setAllObligations] = useState<Obligation[]>([])
    const [filteredObligations, setFilteredObligations] = useState<Obligation[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<ObligationStatus>(ObligationStatus.All)
    const [actionLoading, setActionLoading] = useState<Obligation | null>(null)
    const [userAudit, setUserAudit] = useState<ClearingAuditResult | null>(null)

    const { publicKey } = useWallet()
    const program = useProgram()

    useEffect(() => {
        loadPositions()
    }, [publicKey])

    useEffect(() => {
        if (String(filter) === String(ObligationStatus.All)) {
            setFilteredObligations(allObligations)
            return
        }

        const filtered = allObligations.filter(o => String(o.status) === String(filter))
        setFilteredObligations(filtered)
    }, [filter, allObligations])

    const loadPositions = async () => {
        if (!publicKey || !program) {
            return
        }

        try {
            setLoading(true)
            let obligations: Obligation[] = []
            try {
                obligations = await getObligationsByParticipantFromDb(API_URL, publicKey)
            } catch (dbError) {
                console.warn('DB obligations fetch failed, fallback to on-chain scan', dbError)
                obligations = await getObligationsByParticipantFromPools(program, publicKey)
            }

            setAllObligations(obligations)
            try {
                const audit = await getLastClearingAudit(API_URL, publicKey)
                setUserAudit(audit)
            } catch (auditError) {
                console.warn('Failed to load user clearing audit', auditError)
                setUserAudit(null)
            }
        } catch (error) {
            console.error('Error loading obligations:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleCancel = async (obligation: Obligation) => {
        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        if (!confirm('Вы уверены, что хотите отменить эту позицию?')) {
            return
        }

        try {
            setActionLoading(obligation)

            const tx = await cancelObligation(program, obligation);

            toast.success('Позиция успешно отклонена!')
            loadPositions()
        } catch (error: any) {
            console.error('Error cancelling obligation:', error)
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

            const tx = await declineObligation(program, obligation);

            toast.success('Позиция успешно отклонена!')
            loadPositions()
        } catch (error: any) {
            console.error('Error declining obligation:', error)
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
            const tx = await confirmObligation(program, obligation)

            toast.success('Позиция подтверждена успешно!')
            loadPositions()
        } catch (error) {
            console.error('Error confirming obligation:', error)
            toast.error('Ошибка при подтверждении позиции')
        }
    }

    const getStatusClass = (status: ObligationStatus) => {
        switch (status) {
            case ObligationStatus.Created:
                return 'status-badge status-pending'
            case ObligationStatus.Confirmed:
                return 'status-badge status-confirmed'
            case ObligationStatus.PartiallyNetted:
                return 'status-badge status-confirmed'
            case ObligationStatus.Netted:
                return 'status-badge status-cleared'
            default:
                return 'status-badge'
        }
    }

    const formatDate = (date: number | null) => {
        if (!date) return '-'
        // On-chain timestamps are usually in seconds, JS Date expects milliseconds.
        const tsMs = date < 1_000_000_000_000 ? date * 1000 : date
        return new Date(tsMs).toLocaleString('ru-RU')
    }

    const cancellationInfo = (obligation: Obligation) => {
        const fromRequested = obligation.fromCancel
        const toRequested = obligation.toCancel

        if (!fromRequested && !toRequested) {
            return "Отмена не запрошена"
        }
        if (fromRequested && toRequested) {
            return "Оба участника запросили отмену"
        }
        if (fromRequested) {
            return "Отмена запрошена дебитором"
        }
        return "Отмена запрошена кредитором"
    }

    // Если кошелёк не подключён — возвращаем пустую страницу
    if (!publicKey) {
        return <h1 style={{ color: '#eee' }}>Доступно только авторизованным пользователям</h1>
    }

    return (
        <div>
            <div className="card">
                {userAudit && (
                    <div style={{ marginBottom: '20px', padding: '12px', background: '#f8f9ff', borderRadius: '8px', border: '1px solid #dfe4ff' }}>
                        <h3 style={{ marginBottom: '8px', color: '#333' }}>Последняя сессия клиринга (ваши данные)</h3>
                        <p style={{ marginBottom: '6px', color: '#555' }}>
                            Session #{userAudit.session_id}, external: {userAudit.data.length}, internal: {userAudit.internal_data.length}
                        </p>
                        <p style={{ marginBottom: '8px', color: '#333', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            Merkle root: {userAudit.merkle_root || '-'}
                        </p>
                        <details>
                            <summary style={{ cursor: 'pointer', color: '#667eea' }}>Показать шаги сессии</summary>
                            <div style={{ marginTop: '8px', maxHeight: '140px', overflowY: 'auto' }}>
                                {userAudit.audit_log.map((entry, idx) => (
                                    <div key={`${entry.step}-${idx}`} style={{ fontSize: '13px', color: '#444', marginBottom: '4px' }}>
                                        <b>{entry.step}</b>: {entry.detail}
                                    </div>
                                ))}
                            </div>
                        </details>
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h1 style={{ color: '#333' }}>Клиринговые позиции</h1>
                    <Link to="/obligations/create" className="btn btn-primary">
                        Создать позицию
                    </Link>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label className="label">Фильтр по статусу:</label>
                    <select
                        className="input"
                        value={filter}
                        onChange={(e) => setFilter(parseInt(e.target.value))}
                        style={{ width: 'auto', display: 'inline-block', marginLeft: '8px' }}
                    >
                        <option value={ObligationStatus.All}>Все</option>
                        <option value={ObligationStatus.Created}>Ожидают подтверждения</option>
                        <option value={ObligationStatus.Confirmed}>Подтверждены</option>
                        <option value={ObligationStatus.PartiallyNetted}>Частично погашены</option>
                        <option value={ObligationStatus.Netted}>Выполнены</option>
                    </select>
                </div>

                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', padding: "40px 0", alignItems: "center", justifyContent: "center" }}>
                        <ClipLoader size={56} speedMultiplier={0.7} />
                        <p>Загрузка...</p>
                    </div>
                ) : filteredObligations.length === 0 ? (
                    <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
                        Позиции не найдены
                    </p>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Дебитор</th>
                                <th>Кредитор</th>
                                <th>Сумма</th>
                                <th>Статус</th>
                                <th>Создано</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredObligations.map((obligation) => (
                                <tr key={obligation.timestamp}>
                                    <td>
                                        <Link to={`/participant/${obligation.from}`} style={{ color: '#667eea' }}>
                                            {obligation.from.toBase58().slice(0, 8)}...
                                        </Link>
                                    </td>
                                    <td>
                                        <Link to={`/participant/${obligation.to}`} style={{ color: '#667eea' }}>
                                            {obligation.to.toBase58().slice(0, 8)}...
                                        </Link>
                                    </td>
                                    <td>{obligation.amount / 1e9} SOL</td>
                                    <td>
                                        <span className={getStatusClass(obligation.status)}>
                                            {MapObligationStatus(obligation.status)}
                                        </span>
                                    </td>
                                    <td>{formatDate(obligation.timestamp)}</td>
                                    <td>
                                        {obligation.status === ObligationStatus.Created && obligation.from.equals(publicKey) && (
                                            <button
                                                className="btn btn-primary"
                                                style={{ padding: '6px 12px', fontSize: '14px' }}
                                                onClick={() => handleConfirm(obligation)}
                                                disabled={actionLoading === obligation}
                                            >
                                                {actionLoading === obligation ? 'Подтверждение...' : 'Подтвердить'}
                                            </button>
                                        )}
                                        {obligation.status === ObligationStatus.Created && obligation.to.equals(publicKey) && (
                                            <button
                                                className="btn btn-danger"
                                                style={{ padding: '6px 12px', fontSize: '14px', marginLeft: '8px' }}
                                                onClick={() => handleDecline(obligation)}
                                                disabled={actionLoading === obligation}
                                            >
                                                {actionLoading === obligation ? 'Отклонение...' : 'Отклонить'}
                                            </button>
                                        )}
                                        {obligation.status === ObligationStatus.Confirmed && (
                                            <button
                                                className="btn btn-danger"
                                                style={{ padding: '6px 12px', fontSize: '14px', marginLeft: '8px' }}
                                                onClick={() => handleCancel(obligation)}
                                                disabled={actionLoading === obligation}
                                            >
                                                {actionLoading === obligation ? 'Отмена...' : 'Отменить'}
                                            </button>
                                        )}
                                        {obligation.status === ObligationStatus.Confirmed && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <span style={{ color: '#856404', fontSize: '12px' }}>
                                                    {cancellationInfo(obligation)}
                                                </span>
                                            </div>
                                        )}
                                        {obligation.status === ObligationStatus.Netted && (
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
