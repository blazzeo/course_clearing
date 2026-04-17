import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useWallet } from '@solana/wallet-adapter-react'
import { cancelObligation, confirmObligation, declineObligation, getObligationsByParticipantFromDb, getObligationsByParticipantFromPools, useProgram } from '../api'
import { Obligation, ObligationStatus } from '../interfaces'
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

function startOfLocalDaySec(isoDate: string): number {
    return Math.floor(new Date(`${isoDate}T00:00:00`).getTime() / 1000)
}

function endOfLocalDaySec(isoDate: string): number {
    return Math.floor(new Date(`${isoDate}T23:59:59.999`).getTime() / 1000)
}

export default function ObligationsPage() {
    const [allObligations, setAllObligations] = useState<Obligation[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<ObligationStatus>(ObligationStatus.All)
    const [dateFrom, setDateFrom] = useState<string>('')
    const [dateTo, setDateTo] = useState<string>('')
    const [actionLoading, setActionLoading] = useState<Obligation | null>(null)
    const [viewMode, setViewMode] = useState<'creditor' | 'debitor'>('creditor')
    // const [userAudit, setUserAudit] = useState<ClearingAuditResult | null>(null)

    const { publicKey } = useWallet()
    const program = useProgram()

    useEffect(() => {
        loadPositions()
    }, [publicKey])

    const filteredObligations = useMemo(() => {
        let list = allObligations
        if (String(filter) !== String(ObligationStatus.All)) {
            list = list.filter((o) => String(o.status) === String(filter))
        }
        if (dateFrom) {
            const fromSec = startOfLocalDaySec(dateFrom)
            list = list.filter((o) => {
                const ts = o.timestamp < 1_000_000_000_000 ? o.timestamp : Math.floor(o.timestamp / 1000)
                return ts >= fromSec
            })
        }
        if (dateTo) {
            const toSec = endOfLocalDaySec(dateTo)
            list = list.filter((o) => {
                const ts = o.timestamp < 1_000_000_000_000 ? o.timestamp : Math.floor(o.timestamp / 1000)
                return ts <= toSec
            })
        }
        return list
    }, [allObligations, filter, dateFrom, dateTo])

    const groupedObligations = useMemo(() => {
        if (!publicKey) {
            return { creditor: [] as Obligation[], debitor: [] as Obligation[] }
        }
        return {
            creditor: filteredObligations.filter((obligation) => obligation.to.equals(publicKey)),
            debitor: filteredObligations.filter((obligation) => obligation.from.equals(publicKey)),
        }
    }, [filteredObligations, publicKey])

    const activeObligations = useMemo(
        () => (viewMode === 'creditor' ? groupedObligations.creditor : groupedObligations.debitor),
        [groupedObligations, viewMode]
    )

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

            await cancelObligation(program, obligation);

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

            await declineObligation(program, obligation);

            toast.success('Позиция успешно отклонена!')
            loadPositions()
        } catch (error: any) {
            console.error('Error declining obligation:', error)
            const errorMessage = error.response?.data?.error || 'Ошибка при отклонении позиции'
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
            await confirmObligation(program, obligation)

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

    const formatOperationalDay = (dayTs?: number) => {
        if (!dayTs) return '-'
        return new Date(dayTs * 1000).toLocaleDateString('ru-RU')
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

    const renderObligationsTable = (title: string, obligations: Obligation[], emptyText: string) => {
        const isCreditorView = viewMode === 'creditor'
        return (
            <div style={{ marginTop: '24px' }}>
                <h2 style={{ color: '#333', marginBottom: '12px' }}>{title}</h2>
                {obligations.length === 0 ? (
                    <p style={{ color: '#666', padding: '16px 0' }}>{emptyText}</p>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{isCreditorView ? 'Дебитор' : 'Кредитор'}</th>
                                <th>Сумма (остаток / номинал)</th>
                                <th>Статус</th>
                                <th>Создано</th>
                                <th>Опер. день расчёта</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {obligations.map((obligation) => (
                                <tr key={obligation.pda.toBase58()}>
                                    <td>
                                        <Link
                                            to={`/participant/${isCreditorView ? obligation.from : obligation.to}`}
                                            style={{ color: '#667eea' }}
                                        >
                                            {(isCreditorView ? obligation.from : obligation.to).toBase58().slice(0, 8)}...
                                        </Link>
                                    </td>
                                    <td>
                                        {obligation.originalAmount != null &&
                                            obligation.originalAmount !== obligation.amount ? (
                                            <span title="Остаток после неттинга / исходный номинал">
                                                {(obligation.amount / 1e9).toFixed(4)} / {(obligation.originalAmount / 1e9).toFixed(4)} SOL
                                            </span>
                                        ) : obligation.amount === 0 && obligation.originalAmount != null && obligation.originalAmount > 0 ? (
                                            <span title="Полностью погашено по клирингу">0 (было {(obligation.originalAmount / 1e9).toFixed(4)} SOL)</span>
                                        ) : (
                                            <span>{(obligation.amount / 1e9).toFixed(4)} SOL</span>
                                        )}
                                    </td>
                                    <td>
                                        <span className={getStatusClass(obligation.status)}>
                                            {MapObligationStatus(obligation.status)}
                                        </span>
                                    </td>
                                    <td>{formatDate(obligation.timestamp)}</td>
                                    <td>{formatOperationalDay(obligation.expectingOperationalDay)}</td>
                                    <td>
                                        {obligation.status === ObligationStatus.Created && obligation.from.equals(publicKey!) && (
                                            <button
                                                className="btn btn-primary"
                                                style={{ padding: '6px 12px', fontSize: '14px' }}
                                                onClick={() => handleConfirm(obligation)}
                                                disabled={actionLoading === obligation}
                                            >
                                                {actionLoading === obligation ? 'Подтверждение...' : 'Подтвердить'}
                                            </button>
                                        )}
                                        {obligation.status === ObligationStatus.Created && obligation.from.equals(publicKey!) && (
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
        )
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
                    <Link to="/obligations/create" className="btn btn-primary">
                        Создать позицию
                    </Link>
                </div>

                <div
                    style={{
                        marginBottom: '16px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px',
                        flexWrap: 'wrap',
                    }}
                >
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            type="button"
                            className={viewMode === 'creditor' ? 'btn btn-primary' : 'btn btn-secondary'}
                            onClick={() => setViewMode('creditor')}
                        >
                            Я кредитор
                        </button>
                        <button
                            type="button"
                            className={viewMode === 'debitor' ? 'btn btn-primary' : 'btn btn-secondary'}
                            onClick={() => setViewMode('debitor')}
                        >
                            Я дебитор
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
                        <div>
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
                        <div>
                            <label className="label">С даты (создание):</label>
                            <input
                                type="date"
                                className="input"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                style={{ marginLeft: '8px', width: 'auto' }}
                            />
                        </div>
                        <div>
                            <label className="label">По дату:</label>
                            <input
                                type="date"
                                className="input"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                style={{ marginLeft: '8px', width: 'auto' }}
                            />
                        </div>
                        {(dateFrom || dateTo) && (
                            <button type="button" className="btn btn-secondary" onClick={() => { setDateFrom(''); setDateTo('') }}>
                                Сбросить даты
                            </button>
                        )}
                    </div>
                </div>
                <p style={{ fontSize: '13px', color: '#555', marginBottom: '16px', maxWidth: '720px' }}>
                    Данные из API: в таблице по умолчанию показан <strong>остаток</strong> по обязательству (
                    <code>remaining_amount</code>
                    ). После клиринга он может стать <strong>0 SOL</strong>, при этом исходная сумма была ненулевой — смотрите колонку «Сумма» (остаток / номинал) и ответ в консоли браузера при загрузке страницы.
                </p>

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
                    <>
                        {renderObligationsTable(
                            viewMode === 'creditor' ? 'Я кредитор' : 'Я дебитор',
                            activeObligations,
                            viewMode === 'creditor'
                                ? 'Нет обязательств, где вы кредитор'
                                : 'Нет обязательств, где вы дебитор'
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
