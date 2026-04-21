import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { getClearingState, getParticipant, getParticipantPda, getUserRole, useProgram } from '../api'
import { UserType } from '../interfaces'

interface LayoutProps {
    children: ReactNode
    userType: UserType
    onRoleUpdate: (role: UserType) => void
}

export default function Layout({ children, userType, onRoleUpdate }: LayoutProps) {
    const { publicKey } = useWallet();
    const location = useLocation();
    const program = useProgram();
    const [operationalDay, setOperationalDay] = useState<number | null>(null);
    const [nextClearingDay, setNextClearingDay] = useState<number | null>(null);
    const [userName, setUserName] = useState<string | null>(null);

    // Обновляем роль при изменении кошелька
    useEffect(() => {
        const updateUserRole = async () => {
            if (!publicKey || !program) {
                onRoleUpdate(UserType.Guest);
                return;
            }

            try {
                const userType = await getUserRole(program, publicKey);
                onRoleUpdate(userType)
            } catch (error) {
                console.error('Error updating user role:', error);
                // При ошибке устанавливаем гостя
                onRoleUpdate(UserType.Guest);
            }
        };

        updateUserRole();
    }, [publicKey, program]);

    const loadOperationalDay = useCallback(async () => {
        if (!program) {
            setOperationalDay(null);
            setNextClearingDay(null);
            return;
        }
        try {
            const state = await getClearingState(program);
            setOperationalDay(state.operational_day);
            setNextClearingDay(
                state.last_clearing_operational_day + state.session_interval_time
            );
        } catch (error) {
            console.error('Error loading operational day:', error);
            setOperationalDay(null);
            setNextClearingDay(null);
        }
    }, [program]);

    useEffect(() => {
        void loadOperationalDay();
        const refreshId = setInterval(() => void loadOperationalDay(), 60_000);
        return () => clearInterval(refreshId);
    }, [loadOperationalDay, location.pathname]);

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void loadOperationalDay();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [loadOperationalDay]);

    useEffect(() => {
        const onClearingStateChanged = () => void loadOperationalDay();
        window.addEventListener('clearing-state-changed', onClearingStateChanged);
        return () => window.removeEventListener('clearing-state-changed', onClearingStateChanged);
    }, [loadOperationalDay]);

    useEffect(() => {
        let cancelled = false;

        const loadUserName = async () => {
            if (!publicKey || !program) {
                setUserName(null);
                return;
            }
            try {
                const participantPda = getParticipantPda(program.programId, publicKey);
                const participant = await getParticipant(program, participantPda);
                if (!cancelled) setUserName(participant?.name ?? null);
            } catch (error) {
                console.error('Error loading participant name:', error);
                if (!cancelled) {
                    setUserName(null);
                }
            }
        };

        loadUserName();
        return () => {
            cancelled = true;
        };
    }, [publicKey, program]);

    const operationalDayLabel = useMemo(() => {
        if (operationalDay == null) return 'Сегодня: недоступно';
        return `Сегодня: ${new Date(operationalDay * 1000).toLocaleDateString('ru-RU')}`;
    }, [operationalDay]);
    const nextClearingLabel = useMemo(() => {
        if (nextClearingDay == null) return 'След. клиринг: недоступно';
        return `След. клиринг: ${new Date(nextClearingDay * 1000).toLocaleDateString('ru-RU')}`;
    }, [nextClearingDay]);


    return (
        <div style={{ minHeight: '100vh' }}>
            <nav style={{
                background: 'rgba(255, 255, 255, 0.95)',
                padding: '1px 0',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                marginBottom: '32px'
            }}>
                <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                        <Link to="/" style={{ fontSize: '24px', fontWeight: 'bold', textDecoration: 'none', color: '#667eea' }}>
                            Clearing Service
                            {userType === UserType.Administator &&
                                <p style={{ fontSize: '18px', color: '#ff2f00' }}>
                                    Admin
                                </p>
                            }
                        </Link>

                        {/* Общие ссылки для всех авторизованных пользователей */}
                        {publicKey && (
                            <Link
                                to="/profile"
                                style={{
                                    textDecoration: 'none',
                                    color: location.pathname === '/profile' ? '#667eea' : '#666',
                                    fontWeight: location.pathname === '/profile' ? '600' : '400'
                                }}
                            >
                                Профиль
                            </Link>
                        )}

                        {/* Ссылки для контрагентов */}
                        {userType === UserType.Counterparty && (
                            <>
                                <Link
                                    to="/obligations"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/obligations' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/obligations' ? '600' : '400'
                                    }}
                                >
                                    Позиции
                                </Link>
                                <Link
                                    to="/bills"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/bills' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/bills' ? '600' : '400'
                                    }}
                                >
                                    Cчета
                                </Link>
                                <Link
                                    to="/sessions"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/sessions' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/sessions' ? '600' : '400'
                                    }}
                                >
                                    Сессии
                                </Link>
                            </>
                        )}

                        {/* Ссылки для администраторов */}
                        {userType === UserType.Administator && (
                            <>
                                <Link
                                    to="/admin"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/admin' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/admin' ? '600' : '400'
                                    }}
                                >
                                    Админ панель
                                </Link>
                                <Link
                                    to="/admin/obligations"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/admin/obligations' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/admin/obligations' ? '600' : '400'
                                    }}
                                >
                                    Обязательства
                                </Link>
                                <Link
                                    to="/admin/bills"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/admin/bills' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/admin/bills' ? '600' : '400'
                                    }}
                                >
                                    Счета
                                </Link>
                                <Link
                                    to="/admin/sessions"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/admin/sessions' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/admin/sessions' ? '600' : '400'
                                    }}
                                >
                                    Сессии
                                </Link>
                            </>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            {
                                publicKey
                                    ?
                                    <span
                                        style={{
                                            marginTop: '4px',
                                            fontSize: '12px',
                                            color: '#334155',
                                            background: 'linear-gradient(135deg, #eef2ff 0%, #e2e8f0 100%)',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '999px',
                                            padding: '4px 10px',
                                            fontWeight: 600,
                                            letterSpacing: '0.2px',
                                            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
                                        }}
                                    >
                                        {nextClearingLabel}
                                    </span>
                                    :
                                    <span
                                        style={{
                                            fontWeight: 'bold',
                                            color: 'var(--error-color, #f44336)',
                                        }}
                                    >
                                        Not Connected
                                    </span>
                            }
                            <span
                                title="Операционный день (из блокчейна)"
                                style={{
                                    marginTop: '4px',
                                    fontSize: '12px',
                                    color: '#334155',
                                    background: 'linear-gradient(135deg, #eef2ff 0%, #e2e8f0 100%)',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '999px',
                                    padding: '4px 10px',
                                    fontWeight: 600,
                                    letterSpacing: '0.2px',
                                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
                                }}
                            >
                                {operationalDayLabel}
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {userName && (
                                <span style={{ fontSize: '14px', color: '#333333' }}>
                                    Имя: <span style={{ fontWeight: 'bold' }}>{userName}</span>
                                </span>
                            )}
                            <WalletMultiButton />
                        </div>
                    </div>
                </div>
            </nav >
            <div className="container">
                {children}
            </div>
        </div >
    )
}
