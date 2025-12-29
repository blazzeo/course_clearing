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

import axios from 'axios'
import { useEffect, useState } from 'react'
import "react-toastify/dist/ReactToastify.css";
import { toast, ToastContainer } from "react-toastify";
import { Route, Routes } from 'react-router-dom'

import { useWallet } from '@solana/wallet-adapter-react'
import '@solana/wallet-adapter-react-ui/styles.css';
import Participant from './pages/Participant'

export const PROGRAM_ID: string = import.meta.env.VITE_PROGRAM_ID!;
export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8001';
export const RPC_URL: string = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function App() {
	const { publicKey } = useWallet();
	const [userRole, setUserRole] = useState<string>('guest');

	async function checkRegistered(address: string) {
		const res = await axios.get(`${API_URL}/api/participants/${address}`)

		return res.status == 200
	}

	useEffect(() => {
		authenticateUser()
	}, [publicKey]);

	const authenticateUser = async () => {
		if (!publicKey) {
			setUserRole('guest');
			return;
		}

		const userAddress = publicKey.toBase58();

		try {
			const user_registered = await checkRegistered(userAddress)

			if (!user_registered) {
				await registerUser(userAddress);
			} else {
				// Получаем информацию о пользователе и его роли
				const userInfo = await getUserInfo(userAddress);
				setUserRole(userInfo.user_type);
			}
		} catch (error) {
			console.error(error);
			setUserRole('guest');
		}
	}

	const getUserInfo = async (address: string) => {
		const res = await axios.get(`${API_URL}/api/profile?address=${address}`)
		return res.data.data;
	}

	const registerUser = async (walletAddress: string) => {
		try {
			const res = await axios.post(`${API_URL}/api/participant/register`, { address: walletAddress })

			if (!res) {
				throw new Error("Registration failed");
			}

			toast.success("User registered");
		} catch (error) {
			console.error(error);
			toast.error("Registration error");
		}
	};

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
					<Route path="/participant/:address" element={
						<ProtectedRoute
							resource="/participant"
							requireWallet={false}
						>
							<Participant />
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
					<Route path="/participant" element={
						<ProtectedRoute
							resource="/participant"
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

