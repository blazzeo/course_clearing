import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import Positions from './pages/Positions'
import CreatePosition from './pages/CreatePosition'
import Bills from './pages/Bills'
import AdminPanel from './pages/AdminPanel'
import AuditorPanel from './pages/AuditorPanel'
import Profile from './pages/Profile'
import Funds from './pages/Funds'
import AccessDenied from './pages/AccessDenied'

import { useEffect, useState } from 'react'
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
import { Route, Routes } from 'react-router-dom'

import { useWallet } from '@solana/wallet-adapter-react'
import '@solana/wallet-adapter-react-ui/styles.css';
import { getParticipantPda, getUserRole, useProgram } from './api'

function App() {
    const { publicKey } = useWallet();
    const program = useProgram();
    const [userRole, setUserRole] = useState<string>('guest');

    useEffect(() => {
        authenticateUser()
    }, [publicKey]);

    const authenticateUser = async () => {
        if (!publicKey || !program) {
            setUserRole('guest');
            return;
        }

        const pda = getParticipantPda(program.programId, publicKey)

        try {
            const participant_role = await getUserRole(program, pda);

            setUserRole(participant_role)
        } catch (error) {
            console.error(error);
            setUserRole('guest');
        }
    }

    return (
        <>
            <ToastContainer position="top-right" autoClose={3000} />
            <Layout userRole={userRole} onRoleUpdate={setUserRole}>
                <Routes>
                    {/* Публичные маршруты */}
                    <Route path="/" element={<Home />} />
                    <Route path="/profile" element={
                        <ProtectedRoute requireWallet={true} resource="/profile" userRole={userRole}>
                            <Profile />
                        </ProtectedRoute>
                    } />

                    {/* Защищенные маршруты для контрагентов */}
                    <Route path="/positions" element={
                        <ProtectedRoute
                            requiredRoles={['counterparty', 'administrator']}
                            resource="/positions"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <Positions />
                        </ProtectedRoute>
                    } />
                    <Route path="/positions/create" element={
                        <ProtectedRoute
                            requiredRoles={['counterparty', 'administrator']}
                            resource="/positions/create"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <CreatePosition />
                        </ProtectedRoute>
                    } />
                    <Route path="/bills" element={
                        <ProtectedRoute
                            requiredRoles={['counterparty', 'administrator']}
                            resource="/bills"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <Bills />
                        </ProtectedRoute>
                    } />
                    <Route path="/funds" element={
                        <ProtectedRoute
                            requiredRoles={['counterparty', 'administrator']}
                            resource="/funds"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <Funds />
                        </ProtectedRoute>
                    } />

                    {/* Защищенные маршруты для аудиторов */}
                    <Route path="/auditor" element={
                        <ProtectedRoute
                            requiredRole="auditor"
                            resource="/auditor"
                            requireWallet={true}
                            userRole={userRole}
                        >
                            <AuditorPanel />
                        </ProtectedRoute>
                    } />

                    {/* Защищенные маршруты для администраторов */}
                    <Route path="/admin" element={
                        <ProtectedRoute
                            requiredRole="administrator"
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
        </>
    )
}

export default App

