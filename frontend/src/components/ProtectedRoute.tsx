import { ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import AccessDenied from '../pages/AccessDenied'

interface ProtectedRouteProps {
    children: ReactNode
    requiredRole?: string
    requiredRoles?: string[]
    resource?: string
    requireWallet?: boolean
    userRole?: string
}

export default function ProtectedRoute({
    children,
    requiredRole,
    requiredRoles,
    resource,
    requireWallet = false,
    userRole = 'guest'
}: ProtectedRouteProps) {
    const { publicKey } = useWallet()

    console.log(requiredRoles)

    // Проверяем подключение кошелька если требуется
    if (requireWallet && !publicKey) {
        return <AccessDenied resource={resource} />
    }

    // Если кошелек не подключен, показываем гостевой контент
    if (!publicKey) {
        if (requiredRole || requiredRoles) {
            return <AccessDenied
                requiredRole={requiredRole}
                resource={resource}
            />
        }
        return <>{children}</>
    }

    // Проверяем доступ по конкретной роли
    if (requiredRole && userRole !== requiredRole) {
        return <AccessDenied
            requiredRole={requiredRole}
            resource={resource}
        />
    }

    // Проверяем доступ по списку ролей
    if (requiredRoles && !requiredRoles.includes(userRole)) {
        return <AccessDenied
            requiredRole={requiredRoles.join(' или ')}
            resource={resource}
        />
    }

    // Доступ разрешен
    return <>{children}</>
}
