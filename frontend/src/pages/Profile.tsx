import { useEffect, useState } from 'react'
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { getBalance, getParticipant, getParticipantPda, registerParticipant, useProgram } from '../api'
import { Participant, UserTypeToString } from '../interfaces';

export default function Profile() {
    const anchorWallet = useAnchorWallet()
    const { connection } = useConnection()
    const program = useProgram()
    const publicKey = anchorWallet?.publicKey ?? null

    const [profile, setProfile] = useState<Participant | null>(null)
    const [balance, setBalance] = useState<number | null>(null)
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
            setBalance(balanceLamports)

            // Participant PDA
            const participantPda = getParticipantPda(program.programId, publicKey);
            const participant = await getParticipant(program, participantPda)

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
            await loadProfile()
            setRegistrationName('')
        } catch (error: any) {
            console.error('registerParticipantOnChain error:', error);

            // Превращаем ошибку в строку для поиска ключевых фраз
            const errorMessage = error?.message || error?.toString() || "";

            // 1. Проверка на нехватку средств (Attempt to debit an account...)
            if (errorMessage.includes("Attempt to debit an account but found no record of a prior credit")) {
                toast.error("На вашем кошельке нет SOL. Пополните баланс для оплаты комиссии.");
            }
            // 2. Проверка на отклонение транзакции пользователем (в Phantom/Solflare)
            else if (errorMessage.includes("User rejected the request")) {
                toast.info("Транзакция отклонена пользователем");
            }
            // 3. Проверка на недостаточность средств для конкретной суммы (если аккаунт не пустой, но денег мало)
            else if (errorMessage.includes("insufficient funds")) {
                toast.error("Недостаточно средств для оплаты транзакции и аренды аккаунта");
            }
            // 4. Ошибка дубликата (если имя уже занято, и ваш контракт кидает кастомную ошибку)
            else if (errorMessage.includes("custom program error: 0x0")) {
                // 0x0 обычно успех, но если контракт вернул ошибку, там будет другой код
                toast.error("Это имя или адрес уже зарегистрированы в системе");
            }
            // Дефолтная ошибка
            else {
                toast.error('Ошибка регистрации: попробуйте позже');
            }
        } finally {
            setIsModalOpen(false)
            setRegistrationName('')
            setBlockchainInitializing(false)
        }
    }

    if (loading) {
        return <div style={{ textAlign: 'center', marginTop: '50px', color: 'white' }}>Загрузка профиля...</div>
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ paddingBottom: '30px', color: 'white' }}>Профиль пользователя</h1>

            {!profile ? (
                /* СОСТОЯНИЕ: НЕ ЗАРЕГИСТРИРОВАН */
                <div style={{
                    background: 'white',
                    padding: '40px',
                    borderRadius: '12px',
                    textAlign: 'center',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                }}>
                    <h2 style={{ color: '#333', marginBottom: '16px' }}>Вы еще не зарегистрированы</h2>
                    <p style={{ color: '#666', marginBottom: '24px' }}>
                        Чтобы совершать операции в системе, необходимо создать профиль в блокчейне.
                    </p>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="btn btn-primary"
                        style={{ padding: '12px 32px', fontSize: '16px' }}
                    >
                        Зарегистрироваться
                    </button>
                </div>
            ) : (
                /* СОСТОЯНИЕ: ПРОФИЛЬ СУЩЕСТВУЕТ */
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
                            <div className="profile_balance-label">Баланс</div>
                            <div className="profile_balance-value">
                                {balance ? (balance / 1e9).toFixed(4) : 0} SOL
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
            )}

            {/* Модальное окно регистрации (общее) */}
            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3 className="modal-title">Создание профиля</h3>
                        <p style={{ marginBottom: '15px', fontSize: '14px', color: '#666' }}>
                            Введите ваше имя для идентификации в системе.
                        </p>
                        <input
                            type="text"
                            value={registrationName}
                            placeholder="Напр: super_user"
                            onChange={(e) => setRegistrationName(e.target.value)}
                            disabled={blockchainInitializing}
                            className="modal-input"
                        />

                        <div className="modal-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setIsModalOpen(false);
                                    setRegistrationName('');
                                }}
                                disabled={blockchainInitializing}
                            >
                                Отмена
                            </button>

                            <button
                                className="btn btn-primary"
                                onClick={registerParticipantOnChain}
                                disabled={blockchainInitializing}
                            >
                                {blockchainInitializing ? 'Регистрация...' : 'Подтвердить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
