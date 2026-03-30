import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { API_URL } from '../main'
import { getAllParticipants, getClearingState, getUserRole, useProgram } from '../api'
import { Participant, UserType } from '../interfaces'

interface SystemSetting {
    id: number,
    key: string,
    value: string,
    description?: string,
    created_at: string,
    updated_at: string
}

export default function AdminPanel() {
    const [allUsers, setAllUsers] = useState<Participant[]>([])
    const [systemSettings, setSystemSettings] = useState<SystemSetting[]>([])
    const [loading, setLoading] = useState(true)
    const [isAdmin, setIsAdmin] = useState(false)
    const [checkingAdmin, setCheckingAdmin] = useState(true)
    const [newAdminAddress, setNewAdminAddress] = useState('')
    const [actionLoading, setActionLoading] = useState(false)
    const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'system'>('users')
    const [newSetting, setNewSetting] = useState({ key: '', value: '', description: '' })

    const { publicKey } = useWallet()
    const program = useProgram()

    useEffect(() => {
        checkAdminStatus()
    }, [publicKey])

    const checkAdminStatus = async () => {
        if (!publicKey || !program) {
            setCheckingAdmin(false)
            return
        }

        try {
            if (await getUserRole(program, publicKey) == UserType.Administator)
                setIsAdmin(isAdmin)
        } catch (error) {
            console.error('Error checking admin status:', error)
            toast.error('Ошибка при проверке прав администратора')
        } finally {
            setCheckingAdmin(false)
        }
    }

    const executeClearingHandler = async () => {
        if (!publicKey || !program) {
            toast.error("Кошелек не найден")
            return
        }

        try {
            let res = await axios.post(`${API_URL}/api/clearing/run`)

        } catch (error) {
            console.error('Error executing clearing:', error)
            toast.error('Ошибка при проведении операции')
        }
    }

    useEffect(() => {
        if (isAdmin) {
            loadAllUsers()
            loadSystemSettings()
        }
    }, [isAdmin])

    const loadAllUsers = async () => {
        if (!program)
            return

        try {
            const participants = await getAllParticipants(program)
            setAllUsers(participants)
        } catch (error) {
            console.error('Error loading users:', error)
            toast.error('Ошибка при загрузке списка пользователей')
        }
    }

    const loadSystemSettings = async () => {
        if (!publicKey || !program)
            return

        try {
            setLoading(true)

            const _state = await getClearingState(program)
            // TODO: fix system settings
        } catch (error) {
            console.error('Error loading settings:', error)
            toast.error('Ошибка при загрузке системных настроек')
        } finally {
            setLoading(false)
        }
    }

    //	TODO: new func to change fee rate

    if (checkingAdmin) {
        return <div className="card">Проверка прав доступа...</div>
    }

    if (!publicKey) {
        return <div className="card">Подключите кошелек для доступа к админ панели</div>
    }

    if (!isAdmin) {
        return <div className="card">У вас нет прав доступа к админ панели</div>
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '24px', color: '#fff' }}>Админ панель</h1>

            {/* Tabs */}
            <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            fontSize: 16,
                            padding: '12px 24px',
                            border: 'none',
                            fontWeight: activeTab === 'users' ? 'bold' : 'normal',
                            background: activeTab === 'users' ? '#667eea' : 'transparent',
                            color: activeTab === 'users' ? 'white' : '#ddd',
                            cursor: 'pointer',
                            borderBottom: activeTab === 'users' ? '2px solid #667eea' : 'none'
                        }}
                    >
                        Управление пользователями
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        style={{
                            fontSize: 16,
                            padding: '12px 24px',
                            border: 'none',
                            fontWeight: activeTab === 'settings' ? 'bold' : 'normal',
                            background: activeTab === 'settings' ? '#667eea' : 'transparent',
                            color: activeTab === 'settings' ? 'white' : '#ddd',
                            cursor: 'pointer',
                            borderBottom: activeTab === 'settings' ? '2px solid #667eea' : 'none'
                        }}
                    >
                        Настройки системы
                    </button>
                    <button
                        onClick={() => setActiveTab('system')}
                        style={{
                            fontSize: 16,
                            padding: '12px 24px',
                            border: 'none',
                            fontWeight: activeTab === 'system' ? 'bold' : 'normal',
                            background: activeTab === 'system' ? '#667eea' : 'transparent',
                            color: activeTab === 'system' ? 'white' : '#ddd',
                            cursor: 'pointer',
                            borderBottom: activeTab === 'system' ? '2px solid #667eea' : 'none'
                        }}
                    >
                        Действия системы
                    </button>
                </div>
            </div>

            {/* Users Management Tab */}
            {activeTab === 'users' && (
                <div>
                    {/* Форма добавления админа */}
                    <div style={{ marginBottom: '32px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                        <h3 style={{ marginBottom: '16px' }}>Добавить администратора</h3>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input
                                type="text"
                                value={newAdminAddress}
                                onChange={(e) => setNewAdminAddress(e.target.value)}
                                placeholder="Введите Solana адрес пользователя"
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    fontFamily: 'monospace',
                                    fontSize: '14px'
                                }}
                            />
                            <button
                                onClick={addAdmin}
                                disabled={actionLoading}
                                style={{
                                    padding: '8px 16px',
                                    background: actionLoading ? '#ccc' : '#4caf50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {actionLoading ? 'Добавление...' : 'Добавить'}
                            </button>
                        </div>
                    </div>

                    {/* Список всех пользователей */}
                    <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Все пользователи системы</h3>
                        {loading ? (
                            <div style={{ padding: '20px' }}>Загрузка...</div>
                        ) : allUsers.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                                Пользователей пока нет
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f5f5f5' }}>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Адрес</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Роль</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Статус</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Баланс</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Действия</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allUsers.map((user) => (
                                            <tr key={user.address} style={{ borderBottom: '1px solid #eee' }}>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                                                    {user.address.slice(0, 8)}...{user.address.slice(-8)}
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    {user.user_type === 'guest' ? 'Гость' :
                                                        user.user_type === 'counterparty' ? 'Контрагент' :
                                                            user.user_type === 'auditor' ? 'Аудитор' :
                                                                user.user_type === 'administrator' ? 'Администратор' : user.user_type}
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <span style={{
                                                        color: user.is_active ? '#4caf50' : '#f44336',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {user.is_active ? 'Активен' : 'Деактивирован'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                                    {user.balance.toLocaleString()} лампортов
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                        <select
                                                            value={user.user_type}
                                                            onChange={(e) => changeUserRole(user.address, e.target.value)}
                                                            disabled={actionLoading}
                                                            style={{
                                                                padding: '4px 8px',
                                                                border: '1px solid #ccc',
                                                                borderRadius: '4px',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            <option value="guest">Гость</option>
                                                            <option value="counterparty">Контрагент</option>
                                                            <option value="auditor">Аудитор</option>
                                                            <option value="administrator">Администратор</option>
                                                        </select>
                                                        <button
                                                            onClick={() => toggleUserStatus(user.address, user.is_active)}
                                                            disabled={actionLoading}
                                                            style={{
                                                                padding: '4px 8px',
                                                                background: user.is_active ? '#ff9800' : '#4caf50',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: actionLoading ? 'not-allowed' : 'pointer',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            {user.is_active ? 'Деакт.' : 'Акт.'}
                                                        </button>
                                                        <button
                                                            onClick={() => deleteUser(user.address)}
                                                            disabled={actionLoading}
                                                            style={{
                                                                padding: '4px 8px',
                                                                background: '#f44336',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: actionLoading ? 'not-allowed' : 'pointer',
                                                                fontSize: '12px'
                                                            }}
                                                        >
                                                            Удалить
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* System Settings Tab */}
            {activeTab === 'settings' && (
                <div>
                    {/* Форма добавления/обновления настройки */}
                    <div style={{ marginBottom: '32px', padding: '20px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                        <h3 style={{ marginBottom: '16px' }}>Добавить/обновить системную настройку</h3>
                        <div style={{ display: 'grid', gap: '12px' }}>
                            <input
                                type="text"
                                value={newSetting.key}
                                onChange={(e) => setNewSetting({ ...newSetting, key: e.target.value })}
                                placeholder="Ключ настройки"
                                style={{
                                    padding: '8px 12px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px'
                                }}
                            />
                            <input
                                type="text"
                                value={newSetting.value}
                                onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
                                placeholder="Значение настройки"
                                style={{
                                    padding: '8px 12px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px'
                                }}
                            />
                            <input
                                type="text"
                                value={newSetting.description}
                                onChange={(e) => setNewSetting({ ...newSetting, description: e.target.value })}
                                placeholder="Описание настройки"
                                style={{
                                    padding: '8px 12px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px'
                                }}
                            />
                            <button
                                onClick={updateSystemSetting}
                                disabled={actionLoading}
                                style={{
                                    padding: '8px 16px',
                                    background: actionLoading ? '#ccc' : '#4caf50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {actionLoading ? 'Обновление...' : 'Обновить настройку'}
                            </button>
                        </div>
                    </div>

                    {/* Список настроек */}
                    <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Системные настройки</h3>
                        {loading ? (
                            <div style={{ padding: '20px' }}>Загрузка...</div>
                        ) : systemSettings.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                                Настроек пока нет
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f5f5f5' }}>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Ключ</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Значение</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Описание</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Обновлено</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {systemSettings.map((setting) => (
                                            <tr key={setting.id} style={{ borderBottom: '1px solid #eee' }}>
                                                <td style={{ padding: '12px', fontWeight: 'bold' }}>{setting.key}</td>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                                                    {setting.value}
                                                </td>
                                                <td style={{ padding: '12px' }}>{setting.description || '-'}</td>
                                                <td style={{ padding: '12px' }}>
                                                    {new Date(setting.updated_at).toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* System Actions Tab */}
            {activeTab === 'system' && (
                <div>
                    <div style={{ display: 'grid', gap: '24px' }}>
                        {/* Запуск клиринга */}
                        <div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                            <h3 style={{ marginBottom: '16px' }}>Запуск процедуры клиринга</h3>
                            <p style={{ marginBottom: '16px', color: '#666' }}>
                                Эта операция проведет неттинг всех подтвержденных позиций и создаст транзакции для расчетов.
                            </p>
                            <button
                                onClick={executeClearingHandler}
                                disabled={actionLoading}
                                style={{
                                    padding: '12px 24px',
                                    background: actionLoading ? '#ccc' : '#ff9800',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                                    fontSize: '16px',
                                    fontWeight: 'bold'
                                }}
                            >
                                {actionLoading ? 'Выполнение клиринга...' : 'Запустить клиринг'}
                            </button>
                        </div>

                        {/* Развертывание смарт-контракта */}
                        <div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                            <h3 style={{ marginBottom: '16px' }}>Развертывание смарт-контракта</h3>
                            <p style={{ marginBottom: '16px', color: '#666' }}>
                                Развертывание смарт-контракта клиринга на Solana blockchain.
                                В реальной реализации это включает компиляцию и развертывание Solana программы.
                            </p>
                            <button
                                onClick={async () => {
                                    if (!confirm('Вы уверены, что хотите развернуть новый смарт-контракт?')) return;

                                    try {
                                        setActionLoading(true);
                                        const response = await axios.post(`${API_URL}/admin/deploy-contract?admin_address=${publicKey?.toBase58()}`);
                                        if (response.data.success) {
                                            toast.success('Смарт-контракт развернут');
                                            alert(`Program ID: ${response.data.data.program_id}`);
                                        } else {
                                            toast.error(response.data.error || 'Ошибка при развертывании');
                                        }
                                    } catch (error: any) {
                                        toast.error(error.response?.data?.error || 'Ошибка при развертывании контракта');
                                    } finally {
                                        setActionLoading(false);
                                    }
                                }}
                                disabled={actionLoading}
                                style={{
                                    padding: '12px 24px',
                                    background: actionLoading ? '#ccc' : '#ff6b35',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                                    fontSize: '16px',
                                    fontWeight: 'bold'
                                }}
                            >
                                {actionLoading ? 'Развертывание...' : 'Развернуть контракт'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
