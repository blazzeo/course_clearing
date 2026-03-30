import { useWallet } from '@solana/wallet-adapter-react'
import { Link } from 'react-router-dom'
import './AccessDenied.css'
import { UserType } from '../interfaces'

interface AccessDeniedProps {
    requiredRoles?: UserType[]
    resource?: string
}

function UserTypeToString(ut: UserType): string {
    switch (ut) {
        case UserType.Guest: return 'Гость'
        case UserType.Counterparty: return 'Контрагент'
        case UserType.Administator: return 'Администратор'
        default: return 'Неизвестно'
    }
}

export default function AccessDenied({ requiredRoles, resource }: AccessDeniedProps) {
    const { publicKey } = useWallet()

    function getRoleDisplayName(roles: UserType[]): string {
        const names = roles.map(UserTypeToString);

        if (names.length === 0) return "";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} или ${names[1]}`;

        return `${names.slice(0, -1).join(", ")} или ${names[names.length - 1]}`;
    }

    const getResourceDisplayName = (resource: string) => {
        switch (resource) {
            case '/admin': return 'Админ-панель'
            case '/positions': return 'Мои позиции'
            case '/positions/create': return 'Создание позиции'
            case '/bills': return 'Мои счета'
            case '/funds': return 'Управление средствами'
            default: return resource
        }
    }

    return (
        <div className="access-denied">
            <div className="access-card">

                <div className="access-icon">🚫</div>

                <h1>Доступ запрещён</h1>

                <p className="access-text">
                    {requiredRoles && resource ? (
                        <>
                            Для доступа к <strong>{getResourceDisplayName(resource)}</strong> требуется роль{' '}
                            <strong>{getRoleDisplayName(requiredRoles)}</strong>.
                            {!publicKey && (
                                <>
                                    <br /><br />
                                    Подключите кошелёк для определения вашей роли.
                                </>
                            )}
                        </>
                    ) : (
                        'У вас нет доступа к этому ресурсу.'
                    )}
                </p>

                <div className={`hint ${publicKey ? 'warning' : 'info'}`}>
                    {!publicKey ? (
                        <>
                            <strong>Подсказка:</strong> подключите Solana-кошелёк для доступа к функциям системы.
                        </>
                    ) : (
                        <>
                            <strong>Подсказка:</strong> обратитесь к администратору для получения прав доступа.
                        </>
                    )}
                </div>

                <div className="actions">
                    <Link to="/" className="btn primary">На главную</Link>
                    <Link to="/profile" className="btn success">Профиль</Link>
                </div>

            </div>
        </div>
    )
}


