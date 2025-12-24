import { useWallet } from '@solana/wallet-adapter-react'
import { Link } from 'react-router-dom'
import './AccessDenied.css'

interface AccessDeniedProps {
	requiredRole?: string
	resource?: string
}

export default function AccessDenied({ requiredRole, resource }: AccessDeniedProps) {
	const { publicKey } = useWallet()

	const getRoleDisplayName = (role: string) => {
		switch (role) {
			case 'guest': return 'Гость'
			case 'counterparty': return 'Контрагент'
			case 'auditor': return 'Аудитор'
			case 'administrator': return 'Администратор'
			default: return 'Неизвестно'
		}
	}

	const getResourceDisplayName = (resource: string) => {
		switch (resource) {
			case '/admin': return 'Админ-панель'
			case '/auditor': return 'Аудитор-панель'
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
					{requiredRole && resource ? (
						<>
							Для доступа к <strong>{getResourceDisplayName(resource)}</strong> требуется роль{' '}
							<strong>{getRoleDisplayName(requiredRole)}</strong>.
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

				<div className="dev-info">
					<strong>Для разработчиков</strong>
					<div>Ресурс: {resource || 'неизвестен'}</div>
					<div>Требуемая роль: {requiredRole || 'не указана'}</div>
					<div>Кошелёк: {publicKey ? 'подключён' : 'не подключён'}</div>
				</div>

			</div>
		</div>
	)
}







