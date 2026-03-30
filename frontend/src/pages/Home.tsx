import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect, useState } from 'react'
import { getClearingState, getUserRole, useProgram } from '../api'
import { SystemInfo, UserType } from '../interfaces'

export default function Home() {
    const { publicKey } = useWallet()
    const program = useProgram()
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
    const [userRole, setUserRole] = useState<UserType>(UserType.Guest)

    useEffect(() => {
        loadSystemInfo()
        loadUserRole()
    }, [publicKey])

    const loadSystemInfo = async () => {
        try {
            if (!publicKey || !program)
                return

            const state = await getClearingState(program)

            setSystemInfo({
                total_participants: state.totalParticipants.toNumber(),
                total_sessions: state.totalSessions.toNumber(),
                total_obligations: state.totalObligations.toNumber(),
                fee_rate_bps: state.feeRateBps.toNumber()
            })

        } catch (error) {
            console.error('Error loading system info:', error)
        }
    }

    const loadUserRole = async () => {
        if (!publicKey || !program) {
            setUserRole(UserType.Guest)
            return
        }

        try {
            const user_role = await getUserRole(program, publicKey);
            setUserRole(user_role)
        } catch (error) {
            console.error(error)
            setUserRole(UserType.Guest)
        }
    }

    return (
        <div>
            <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
                <h1 style={{ fontSize: '48px', marginBottom: '24px', color: '#333' }}>
                    Клиринговый сервис на блокчейне
                </h1>
                <p style={{ fontSize: '20px', color: '#666', marginBottom: '32px' }}>
                    Децентрализованный сервис для клиринговых расчетов на Solana
                </p>

                {/* Кнопки действий в зависимости от роли */}
                <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {userRole === UserType.Guest && publicKey && (
                        <>
                            <Link to="/profile" className="btn btn-primary">
                                Профиль
                            </Link>
                        </>
                    )}
                    {userRole === UserType.Counterparty && (
                        <>
                            <Link to="/positions/create" className="btn btn-primary">
                                Создать позицию
                            </Link>
                            <Link to="/positions" className="btn btn-secondary">
                                Мои позиции
                            </Link>
                            <Link to="/bills" className="btn btn-secondary">
                                Мои счета
                            </Link>
                            <Link to="/funds" className="btn btn-secondary">
                                Управление средствами
                            </Link>
                        </>
                    )}
                    {userRole === UserType.Administator && (
                        <Link to="/admin" className="btn btn-primary">
                            Админ панель
                        </Link>
                    )}
                </div>
            </div>

            {/* Статистика системы для гостей */}
            {systemInfo && (
                <div className="card" style={{ marginTop: '32px' }}>
                    <h2 style={{ marginBottom: '24px', color: '#333' }}>Статистика системы</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                        <div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4caf50' }}>{systemInfo.total_participants}</div>
                            <div style={{ color: '#666' }}>Всего контрагентов</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#9c27b0' }}>{systemInfo.total_obligations}</div>
                            <div style={{ color: '#666' }}>Всего обязательств</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#607d8b' }}>{systemInfo.total_sessions}</div>
                            <div style={{ color: '#666' }}>Клиринговых сессий</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#600000' }}>{systemInfo.fee_rate_bps}</div>
                            <div style={{ color: '#666' }}>Процент комиссий</div>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginTop: '32px' }}>
                <div className="card">
                    <h2 style={{ marginBottom: '16px', color: '#333' }}>Двусторонний клиринг</h2>
                    <p style={{ color: '#666', marginBottom: '16px' }}>
                        Создавайте клиринговые позиции между двумя участниками.
                        Позиции требуют подтверждения от контрагента перед выполнением расчета.
                    </p>
                    <Link to="/positions/create" className="btn btn-primary" style={{ width: '100%' }}>
                        Создать позицию
                    </Link>
                </div>

                <div className="card">
                    <h2 style={{ marginBottom: '16px', color: '#333' }}>Многосторонний клиринг</h2>
                    <p style={{ color: '#666', marginBottom: '16px' }}>
                        Выполняйте netting для нескольких участников одновременно.
                        Система автоматически рассчитывает чистые позиции.
                    </p>
                    <Link to="/clearing/multi-party" className="btn btn-primary" style={{ width: '100%' }}>
                        Многосторонний клиринг
                    </Link>
                </div>

            </div>

            <div className="card" style={{ marginTop: '32px' }}>
                <h2 style={{ marginBottom: '16px', color: '#333' }}>Как это работает</h2>
                <ol style={{ paddingLeft: '24px', color: '#666', lineHeight: '1.8' }}>
                    <li style={{ marginBottom: '12px' }}>
                        <strong>Подключите кошелек:</strong> Используйте Phantom или Solflare для подключения к сервису
                    </li>
                    <li style={{ marginBottom: '12px' }}>
                        <strong>Создайте позицию:</strong> Укажите контрагента и сумму для клиринга
                    </li>
                    <li style={{ marginBottom: '12px' }}>
                        <strong>Подтверждение:</strong> Контрагент подтверждает позицию
                    </li>
                    <li style={{ marginBottom: '12px' }}>
                        <strong>Выполнение:</strong> Система автоматически выполняет клиринг и выставляет счета для оплаты
                    </li>
                </ol>
            </div>
        </div>
    )
}
