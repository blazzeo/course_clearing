// providers/UserRoleProvider.tsx
import { createContext, useContext, useState, ReactNode } from 'react';
import { UserType } from '../interfaces';

interface UserRoleContextType {
    userRole: UserType;
    setUserRole: (role: UserType) => void;
}

const UserRoleContext = createContext<UserRoleContextType | null>(null);

export function UserRoleProvider({ children }: { children: ReactNode }) {
    const [userRole, setUserRole] = useState<UserType>(UserType.Guest);

    return (
        <UserRoleContext.Provider value={{ userRole, setUserRole, }}>
            {children}
        </UserRoleContext.Provider>
    );
}

export function useUserRole() {
    const context = useContext(UserRoleContext);
    if (!context) {
        throw new Error('useUserRole must be used inside UserRoleProvider');
    }
    return context;
}
