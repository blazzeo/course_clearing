import { ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { getUserRole, useProgram } from '../api'
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
                                    to="/positions"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/positions' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/positions' ? '600' : '400'
                                    }}
                                >
                                    Мои позиции
                                </Link>
                                <Link
                                    to="/positions/create"
                                    style={{
                                        textDecoration: 'none',
                                        color: location.pathname === '/positions/create' ? '#667eea' : '#666',
                                        fontWeight: location.pathname === '/positions/create' ? '600' : '400'
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
