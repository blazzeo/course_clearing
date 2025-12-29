import { ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import axios from 'axios'
import { API_URL } from '../App'
import { toast } from 'react-toastify'

interface LayoutProps {
	children: ReactNode
	userRole: string
	onRoleUpdate: (role: string) => void
}

export default function Layout({ children, userRole, onRoleUpdate }: LayoutProps) {
	const { publicKey } = useWallet();
	const location = useLocation();

	// Обновляем роль при изменении кошелька
	useEffect(() => {
		updateUserRole();
	}, [publicKey]);

	const updateUserRole = async () => {
		if (!publicKey) {
			onRoleUpdate('guest');
			localStorage.setItem('userRole', 'guest');
			return;
		}

		try {
			const userAddress = publicKey.toBase58();

			const res = await axios.get(
				`${API_URL}/api/profile?address=${userAddress}`,
				{
					validateStatus: (status) => status === 200 || status === 404
				}
			);

			if (res.status === 404) {
				await axios.post(`${API_URL}/api/auth/register-guest`, { address: userAddress });
				onRoleUpdate('guest');
				localStorage.setItem('userRole', 'guest');
				toast.success('Вы успешно зарегистрированы!')
			} else {
				const role = res.data.data.user_type;
				onRoleUpdate(role);
				localStorage.setItem('userRole', role);
				toast.success('Вход выполнен успешно!')
			}
		} catch (error) {
			console.error('Error updating user role:', error);
			// При ошибке устанавливаем гостя
			onRoleUpdate('guest');
			localStorage.setItem('userRole', 'guest');
		}
	};

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
						{userRole === 'counterparty' && (
							<>
								<Link
									to="/positions"
									style={{
										textDecoration: 'none',
										color: location.pathname === '/positions' ? '#667eea' : '#666',
										fontWeight: location.pathname === '/positions' ? '600' : '400'
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
									Счета
								</Link>
								<Link
									to="/funds"
									style={{
										textDecoration: 'none',
										color: location.pathname === '/funds' ? '#667eea' : '#666',
										fontWeight: location.pathname === '/funds' ? '600' : '400'
									}}
								>
									Управление средствами
								</Link>
							</>
						)}

						{/* Ссылки для аудиторов */}
						{userRole === 'auditor' && (
							<Link
								to="/auditor"
								style={{
									textDecoration: 'none',
									color: location.pathname === '/auditor' ? '#667eea' : '#666',
									fontWeight: location.pathname === '/auditor' ? '600' : '400'
								}}
							>
								Аудит
							</Link>
						)}

						{/* Ссылки для администраторов */}
						{userRole === 'administrator' && (
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
								Роль: {userRole === 'guest' ? 'Гость' :
									userRole === 'counterparty' ? 'Контрагент' :
										userRole === 'auditor' ? 'Аудитор' :
											userRole === 'administrator' ? 'Администратор' : 'Неизвестно'}
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

