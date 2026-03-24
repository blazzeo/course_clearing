import { useEffect, useState } from 'react'
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, } from '@solana/web3.js'
import { toast } from 'react-toastify'
import { getBalance, getParticipant, getParticipantPda, registerParticipant, useProgram } from '../api'
import { sha256 } from 'js-sha256'

interface UserProfile {
    address: string
    user_type: string
    name: string
    is_active: boolean
    balance: number
    created_at: string
    updated_at?: string
}

export default function Profile() {
    const anchorWallet = useAnchorWallet()
    const { connection } = useConnection()
    const program = useProgram()
    const publicKey = anchorWallet?.publicKey ?? null

    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState(false)
    const [blockchainInitializing, setBlockchainInitializing] = useState(false)
    const [registrationName, setRegistrationName] = useState('')
    const [formData, setFormData] = useState({
        name: '',
    })

    useEffect(() => {
        if (!publicKey || !program) return
        loadProfile()
    }, [publicKey])

    const loadProfile = async () => {
        if (!publicKey || !program) return

        try {
            setLoading(true)

            // Баланс берем как SOL на адресе (lamports -> SOL).
            const balanceLamports = await getBalance(connection, publicKey)

            // Participant PDA
            const participantPda = getParticipantPda(program.programId, publicKey);

            let participantAccount: any = null
            try {
                participantAccount = await getParticipant(program, participantPda)
                console.log(participantAccount)
            } catch {
                participantAccount = null
            }

            // Если аккаунта участника нет — показываем "гостя".
            if (!participantAccount) {
                setProfile({
                    address: publicKey.toBase58(),
                    name: '',
                    user_type: 'guest',
                    is_active: false,
                    balance: balanceLamports,
                    created_at: '',
                    updated_at: '',
                })
                setFormData({
                    name: '',
                })
                return
            }

            const nameRegistryPda = participantAccount.nameRegistry as PublicKey
            const nameRegistryAccount: any = await program.account.nameRegistry.fetch(nameRegistryPda)

            const nameBytes: number[] = Array.from(nameRegistryAccount.nameBytes ?? [])
            const endIdx = nameBytes.indexOf(0)
            const safeEnd = endIdx === -1 ? nameBytes.length : endIdx
            const name = new TextDecoder().decode(Uint8Array.from(nameBytes.slice(0, safeEnd)))

            const ut = participantAccount.userType
            const role =
                ut?.participant !== undefined ? 'counterparty' :
                    ut?.admin !== undefined ? 'administrator' :
                        ut?.officer !== undefined ? 'auditor' : 'guest'

            const registrationTimestamp = participantAccount.registrationTimestamp?.toNumber?.() ?? participantAccount.registrationTimestamp ?? 0
            const updateTimestamp = participantAccount.updateTimestamp?.toNumber?.() ?? participantAccount.updateTimestamp ?? 0

            setProfile({
                address: publicKey.toBase58(),
                name: name,
                user_type: role,
                is_active: true,
                balance: balanceLamports,
                created_at: registrationTimestamp ? new Date(registrationTimestamp * 1000).toISOString() : '',
                updated_at: updateTimestamp ? new Date(updateTimestamp * 1000).toISOString() : '',
            })

            setFormData({
                name: name,
            })
        } catch (error) {
            console.error('Error loading profile from blockchain:', error)
            toast.error('Ошибка загрузки профиля из блокчейна')
            setProfile(null)
        } finally {
            setLoading(false)
        }
    }

    const handleUpdateProfile = async () => {
        // В текущем контракте нет инструкций для изменения полей профиля.
        toast.info('Редактирование профиля пока недоступно')
        setEditing(false)
    }

    const registerParticipantOnChain = async () => {
        if (!publicKey || !program) return

        const name = registrationName.trim();

        if (!name) {
            toast.error('Введите имя для профиля');
            return;
        }

        if (name.length > 32) {
            toast.error('Имя должно быть не длиннее 32 символов');
            return;
        }

        try {
            setBlockchainInitializing(true)

            // ✅ SHA256 → Uint8Array (32 bytes)
            const hashBytes = new Uint8Array(sha256.array(name));

            // ✅ Anchor ожидает number[]
            const nameHash = Array.from(hashBytes);

            const tx = await registerParticipant(program, nameHash);

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Профиль зарегистрирован в блокчейне')
            setRegistrationName('')
            await loadProfile()
        } catch (error) {
            console.error('registerParticipantOnChain error:', error)
            toast.error('Ошибка регистрации профиля')
        } finally {
            setBlockchainInitializing(false)
        }
    }

    const handleCancel = () => {
        if (profile) {
            setFormData({
                name: profile.name || '',
            })
        }
        setEditing(false)
    }

    if (loading) {
        return <div>Загрузка профиля...</div>
    }

    if (!profile) {
        return <div>Профиль не найден</div>
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ paddingBottom: '30px', color: 'white' }}>Профиль пользователя</h1>

            {/* Плашка для гостей */}
            {profile.user_type === 'guest' && (
                <div style={{
                    background: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                        <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: '#856404',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: 'bold'
                        }}>
                            !
                        </div>
                        <div style={{ flex: 1 }}>
                            <h4 style={{ margin: '0 0 4px 0', color: '#856404' }}>
                                Аккаунт не найден
                            </h4>
                            <p style={{ margin: 0, color: '#856404', fontSize: '14px' }}>
                                Ваш аккаунт имеет статус "Гость".
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                                type="text"
                                value={registrationName}
                                placeholder="Имя (до 32 символов)"
                                onChange={(e) => setRegistrationName(e.target.value)}
                                disabled={blockchainInitializing}
                                style={{
                                    padding: '8px 12px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    minWidth: '260px',
                                    fontSize: '14px'
                                }}
                            />
                            <button
                                onClick={registerParticipantOnChain}
                                disabled={blockchainInitializing}
                                style={{
                                    padding: '8px 16px',
                                    background: blockchainInitializing ? '#ccc' : '#667eea',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: blockchainInitializing ? 'not-allowed' : 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                {blockchainInitializing ? 'Регистрация...' : 'Зарегистрировать в блокчейне'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ background: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <div style={{ marginBottom: '24px' }}>
                    <h3>Основная информация</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Адрес кошелька:</label>
                            <div style={{ fontFamily: 'monospace', fontSize: '14px', wordBreak: 'break-all' }}>
                                {profile.address}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Роль:</label>
                            <div>
                                {profile.user_type === 'guest' ? 'Гость' :
                                    profile.user_type === 'counterparty' ? 'Контрагент' :
                                        profile.user_type === 'auditor' ? 'Аудитор' :
                                            profile.user_type === 'administrator' ? 'Администратор' : 'Неизвестно'}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Баланс:</label>
                            <div>{profile.balance} лампортов</div>
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3>Личная информация</h3>
                        {!editing ? (
                            <button
                                onClick={() => toast.info('Редактирование имени пока недоступно')}
                                style={{
                                    padding: '8px 16px',
                                    background: '#667eea',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Редактировать
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={handleUpdateProfile}
                                    style={{
                                        padding: '8px 16px',
                                        background: '#4caf50',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Сохранить
                                </button>
                                <button
                                    onClick={handleCancel}
                                    style={{
                                        padding: '8px 16px',
                                        background: '#f44336',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Отмена
                                </button>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Имя:</label>
                            {editing ? (
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                />
                            ) : (
                                <div>{profile.name || 'Не указано'}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div>
                    <h3>Даты</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Дата регистрации:</label>
                            <div>
                                {profile.created_at ? new Date(profile.created_at).toLocaleString() : 'Неизвестно'}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Последнее обновление:</label>
                            <div>{profile.updated_at ? new Date(profile.updated_at).toLocaleString() : 'Не обновлялось'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
