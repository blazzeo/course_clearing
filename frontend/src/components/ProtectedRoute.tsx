import { ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import AccessDenied from '../pages/AccessDenied'
import { UserType } from '../interfaces'

interface ProtectedRouteProps {
    children: ReactNode
    requiredRoles?: UserType[]
    resource?: string
    requireWallet?: boolean
    userRole?: UserType
}

export default function ProtectedRoute({
    children,
    requiredRoles,
    resource,
    requireWallet = false,
    userRole = UserType.Guest
}: ProtectedRouteProps) {
    const { publicKey } = useWallet()

    // Проверяем подключение кошелька если требуется
    if (requireWallet && !publicKey) {
        return <AccessDenied resource={resource} />
    }

    // Если кошелек не подключен, показываем гостевой контент
    if (!publicKey) {
        if (requiredRoles) {
            return <AccessDenied
                requiredRoles={requiredRoles}
                resource={resource}
            />
        }
        return <>{children}</>
    }

    // Проверяем доступ по списку ролей
    if (requiredRoles && !requiredRoles.includes(userRole)) {
        return <AccessDenied
            requiredRoles={requiredRoles}
            resource={resource}
        />
    }

    // Доступ разрешен
    return <>{children}</>
}
