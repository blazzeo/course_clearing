import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { getClearingState, getUserRole, useProgram } from '../api'
import { UserType, UserTypeToString } from '../interfaces'

interface LayoutProps {
    children: ReactNode
    userType: UserType
    onRoleUpdate: (role: UserType) => void
}

export default function Layout({ children, userType, onRoleUpdate }: LayoutProps) {
    const { publicKey } = useWallet();
    const location = useLocation();
    const program = useProgram();
    const [nextSessionAt, setNextSessionAt] = useState<number | null>(null);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);

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

    useEffect(() => {
        let cancelled = false;

        const loadSessionTimer = async () => {
            if (!program) {
                setNextSessionAt(null);
                setTimeLeft(null);
                return;
            }
            try {
                const state = await getClearingState(program);
                const nextTs = state.last_session_timestamp + state.session_interval_time;
                if (cancelled) return;
                setNextSessionAt(nextTs);
            } catch (error) {
                console.error('Error loading clearing timer:', error);
                if (!cancelled) {
                    setNextSessionAt(null);
                    setTimeLeft(null);
                }
            }
        };

        loadSessionTimer();
        const refreshId = setInterval(loadSessionTimer, 300_000);
        return () => {
            cancelled = true;
            clearInterval(refreshId);
        };
    }, [program]);

    useEffect(() => {
        if (!nextSessionAt) return;
        const tick = () => {
            const now = Math.floor(Date.now() / 1000);
            setTimeLeft(Math.max(nextSessionAt - now, 0));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [nextSessionAt]);

    const timerLabel = useMemo(() => {
        if (timeLeft == null) return 'Таймер сессии недоступен';
        if (timeLeft === 0) return 'Сессия может начаться в любой момент';
        const d = Math.floor(timeLeft / 86400);
        const h = Math.floor((timeLeft % 86400) / 3600);
        const m = Math.floor((timeLeft % 3600) / 60);
        const s = timeLeft % 60;
        if (d > 0) return `${d}д ${h}ч ${m}м ${s}с`;
        if (h > 0) return `${h}ч ${m}м ${s}с`;
        return `${m}м ${s}с`;
    }, [timeLeft]);


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
                                    Мои позиции
                                </Link>
                                <Link
                                    to="/obligations/create"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/obligations/create' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/obligations/create' ? '600' : '400'
                                    }}
                                >
                                    Создать позицию
                                </Link>
                                <Link
                                    to="/bills"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/bills' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/bills' ? '600' : '400'
                                    }}
                                >
                                    Мои счета
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
                                    to="/clearing/multi-party"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/clearing/multi-party' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/clearing/multi-party' ? '600' : '400'
                                    }}
                                >
                                    Клиринг
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
                                            fontWeight: 'bold',
                                            color: 'var(--success-color, #4caf50)',
                                        }}
                                    >
                                        Connected
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
                            <span style={{ fontSize: '12px', color: '#666' }}>
                                Роль: {UserTypeToString(userType)}
                            </span>
                            <span
                                title="Время до следующей клиринговой сессии"
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
                                {timerLabel}
                            </span>
                        </div>
                        <WalletMultiButton />
                    </div>
                </div>
            </nav >
            <div className="container">
                {children}
            </div>
        </div >
    )
}
