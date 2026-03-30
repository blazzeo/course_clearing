import { useEffect, useState } from 'react'
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { getBalance, getParticipant, getParticipantPda, registerParticipant, useProgram } from '../api'
import { Participant, UserType } from '../interfaces';

export function UserTypeToString(userType: UserType): String {
    switch (userType) {
        case UserType.Counterparty: return 'Контрагент';
        case UserType.Administator: return 'Администратор';
        case UserType.Guest: return 'Гость';
        default: return 'Неизвестно'
    }
}

export default function Profile() {
    const anchorWallet = useAnchorWallet()
    const { connection } = useConnection()
    const program = useProgram()
    const publicKey = anchorWallet?.publicKey ?? null

    const [profile, setProfile] = useState<Participant | null>(null)
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [blockchainInitializing, setBlockchainInitializing] = useState(false)
    const [registrationName, setRegistrationName] = useState('')

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

            const participant = await getParticipant(program, participantPda)

            // Если аккаунта участника нет — показываем "гостя".
            if (!participant) {
                setProfile({
                    authority: publicKey.toBase58(),
                    name: '',
                    user_type: 'guest',
                    is_active: false,
                    balance: balanceLamports,
                    created_at: '',
                    updated_at: '',
                })
                return
            }

            setProfile(participant)

        } catch (error) {
            console.error('Error loading profile from blockchain:', error)
            toast.error('Ошибка загрузки профиля из блокчейна')
            setProfile(null)
        } finally {
            setLoading(false)
        }
    }

    const registerParticipantOnChain = async () => {
        if (!publicKey || !program) return

        const name = registrationName.trim();

        if (!name) {
            toast.error('Введите имя для профиля');
            setRegistrationName('')
            return;
        }

        if (name.length > 32) {
            toast.error('Имя должно быть не длиннее 32 символов');
            setRegistrationName('')
            return;
        }

        try {
            setBlockchainInitializing(true)

            const tx = await registerParticipant(program, name);

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
            setRegistrationName('')
            setBlockchainInitializing(false)
        }
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
            {profile.userType === UserType.Guest && (
                <div style={{ marginBottom: '24px' }}>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className={"btn btn-secondary"}
                    >
                        Зарегистрироваться
                    </button>
                </div>
            )
            }

            <div className="profile">

                <div className="profile_header">
                    <div>
                        <h2 className="profile_title">
                            {profile.name || 'Пользователь'}
                        </h2>
                        <p className="profile_subtitle">
                            {UserTypeToString(profile.userType)}
                        </p>
                    </div>

                    <div className="profile_balance">
                        <div className="profile_balance-label">
                            Баланс
                        </div>
                        <div className="profile_balance-value">
                            {(profile.balance / 1e9).toFixed(4)} SOL
                        </div>
                    </div>
                </div>

                <div className="profile_section">
                    <p className="profile_label">Адрес кошелька</p>
                    <div className="profile_wallet">
                        {profile.authority.toBase58()}
                    </div>
                </div>

                <div className="profile_grid">

                    <div>
                        <p className="profile_label">Имя</p>
                        <p>{profile.name || 'Не указано'}</p>
                    </div>

                    <div>
                        <p className="profile_label">Роль</p>
                        <p>{UserTypeToString(profile.userType)}</p>
                    </div>

                    <div>
                        <p className="profile_label">Дата регистрации</p>
                        <p>
                            {profile.registrationTimestamp
                                ? new Date(profile.registrationTimestamp).toLocaleString()
                                : 'Неизвестно'}
                        </p>
                    </div>

                    <div>
                        <p className="profile_label">Обновлено</p>
                        <p>
                            {profile.updateTimestamp
                                ? new Date(profile.updateTimestamp).toLocaleString()
                                : 'Не обновлялось'}
                        </p>
                    </div>

                </div>
            </div>

            {
                isModalOpen && (
                    <div className="modal-overlay">
                        <div className="modal">

                            <h3 className="modal-title">Регистрация</h3>

                            <input
                                type="text"
                                value={registrationName}
                                placeholder="Введите имя (< 32 символа)"
                                onChange={(e) => setRegistrationName(e.target.value)}
                                disabled={blockchainInitializing}
                                className="modal-input"
                            />

                            <div className="modal-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setIsModalOpen(false)}
                                >
                                    Отмена
                                </button>

                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        registerParticipantOnChain();
                                        setIsModalOpen(false);
                                    }}
                                    disabled={blockchainInitializing}
                                >
                                    {blockchainInitializing ? 'Регистрация...' : 'Подтвердить'}
                                </button>
                            </div>

                        </div>
                    </div>
                )
            }

        </div >

    )
}
