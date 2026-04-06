import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import ObligationsPage from './pages/ObligationsPage'
import CreateObligation from './pages/CreateObligation'
import Bills from './pages/Bills'
import AdminPanel from './pages/AdminPanel'
import Profile from './pages/Profile'
import Funds from './pages/Funds'
import AccessDenied from './pages/AccessDenied'

import { useEffect } from 'react'
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
import { Route, Routes } from 'react-router-dom'

import { useWallet } from '@solana/wallet-adapter-react'
import '@solana/wallet-adapter-react-ui/styles.css';
import { getParticipantPda, getUserRole, useProgram } from './api'
import { UserType } from './interfaces'
import { AppProviders } from './providers/BlockchainProviders'
import { useUserRole } from './providers/UserTypeProvider'
import { ClipLoader } from 'react-spinners'
import ParticipantPage from './pages/Participant'

function App() {
    const { publicKey } = useWallet();
    const program = useProgram();
    const { userRole, setUserRole } = useUserRole()

    useEffect(() => {
        authenticateUser()
    }, [publicKey]);

    const authenticateUser = async () => {
        if (!publicKey || !program) {
            setUserRole(UserType.Guest);
            return;
        }

        const pda = getParticipantPda(program.programId, publicKey)

        try {
            const participant_role = await getUserRole(program, pda);

            setUserRole(participant_role)
        } catch (error) {
            console.error(error);
            setUserRole(UserType.Guest);
        }
    }

    return (
        <AppProviders program={program!} publicKey={publicKey} isAdmin={userRole === UserType.Administator}>
            <ToastContainer position="top-right" autoClose={3000} />
            <Layout userType={userRole} onRoleUpdate={setUserRole}>
                <Routes>
                    {/* Публичные маршруты */}
                    <Route path="/" element={<Home />} />
                    <Route path="/profile" element={
                        <ProtectedRoute requireWallet={true} resource="/profile">
                            <Profile />
                        </ProtectedRoute>
                    } />
                    <Route path="/participant/:address" element={
                        <ProtectedRoute requireWallet={true} resource="/participant">
                            <ParticipantPage />
                        </ProtectedRoute>
                    } />

                    {/* Защищенные маршруты для контрагентов */}
                    <Route path="/obligations" element={
                        <ProtectedRoute
                            requiredRoles={[UserType.Counterparty]}
                            resource="/obligations"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <ObligationsPage />
                        </ProtectedRoute>
                    } />
                    <Route path="/obligations/create" element={
                        <ProtectedRoute
                            requiredRoles={[UserType.Counterparty]}
                            resource="/obligations/create"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <CreateObligation />
                        </ProtectedRoute>
                    } />
                    <Route path="/bills" element={
                        <ProtectedRoute
                            requiredRoles={[UserType.Counterparty]}
                            resource="/bills"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <Bills />
                        </ProtectedRoute>
                    } />
                    <Route path="/funds" element={
                        <ProtectedRoute
                            requiredRoles={[UserType.Counterparty]}
                            resource="/funds"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <Funds />
                        </ProtectedRoute>
                    } />

                    {/* Защищенные маршруты для администраторов */}
                    <Route path="/admin" element={
                        <ProtectedRoute
                            requiredRoles={[UserType.Administator]}
                            resource="/admin"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <AdminPanel />
                        </ProtectedRoute>
                    } />

                    {/* Fallback для всех остальных маршрутов */}
                    <Route path="*" element={<AccessDenied />} />
                </Routes>
            </Layout>
        </AppProviders>
    )
}

export default App

