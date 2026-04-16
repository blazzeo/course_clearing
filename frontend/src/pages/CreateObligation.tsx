import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { getParticipantByUserName, getParticipantsFromDb, getPool, getPoolPda, registerObligation, useProgram } from '../api'
import { PublicKey } from '@solana/web3.js'
import { ParticipantDirectoryEntry } from '../interfaces'
import { API_URL } from '../main'

export default function CreateObligation() {
    const { publicKey } = useWallet()
    const program = useProgram()
    const navigate = useNavigate()
    const [counterparty, setCounterparty] = useState('')
    const [counterpartyName, setCounterpartyName] = useState('')
    const [amount, setAmount] = useState('')
    const [loading, setLoading] = useState(false)
    const [lookupLoading, setLookupLoading] = useState(false)
    const [participants, setParticipants] = useState<ParticipantDirectoryEntry[]>([])
    const [participantsLoading, setParticipantsLoading] = useState(false)

    useEffect(() => {
        const loadParticipants = async () => {
            try {
                setParticipantsLoading(true)
                const data = await getParticipantsFromDb(API_URL)
                setParticipants(data)
            } catch (error) {
                console.error('Error loading participants from DB:', error)
            } finally {
                setParticipantsLoading(false)
            }
        }

        loadParticipants()
    }, [])

    const availableParticipants = useMemo(() => {
        if (!publicKey) return participants
        const self = publicKey.toBase58()
        return participants.filter((participant) => participant.authority !== self)
    }, [participants, publicKey])

    const handleSelectParticipant = (authority: string) => {
        const selected = availableParticipants.find((participant) => participant.authority === authority)
        setCounterparty(authority)
        setCounterpartyName(selected?.user_name ?? '')
    }

    const handleLookupByName = async () => {
        if (!program) {
            toast.error('Программа не инициализирована')
            return
        }
        if (!counterpartyName.trim()) {
            toast.error('Введите user_name')
            return
        }
        try {
            setLookupLoading(true)
            const participant = await getParticipantByUserName(program, counterpartyName)
            if (!participant) {
                toast.error('Контрагент с таким user_name не найден')
                return
            }
            setCounterparty(participant.authority.toBase58())
            toast.success(`Найден: ${participant.name}`)
        } catch (error) {
            console.error('Error searching participant by user_name:', error)
            toast.error('Ошибка поиска по user_name')
        } finally {
            setLookupLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!publicKey || !program) {
            toast.error('Пожалуйста, подключите кошелек')
            return
        }

        if (!counterparty || !amount) {
            toast.error('Заполните все поля')
            return
        }

        try {
            setLoading(true)
            const amountLamports = parseFloat(amount) * 1e9

            const timestamp = Math.floor(Date.now() / 1000)

            const counterPartyPubkey = new PublicKey(counterparty)

            let pool_id = 0;
            let free_pool_found = false

            // loop until we find free pool
            // or fetch pools until we find free pool
            while (!free_pool_found) {
                const pool_pda = getPoolPda(program, pool_id);

                const pool = await getPool(program, pool_pda);

                //	Free pool found
                if (pool && pool?.occupiedCount < 50) {
                    free_pool_found = true
                    break
                }

                //	No pool found -> Need to create new pool
                if (!pool) {
                    throw new Error('Свободный пул не найден. Обратитесь к администратору для создания нового пула.')
                }

                pool_id++

                if (pool_id > 10) {
                    throw new Error('Не удалось найти свободный пул')
                }

                console.log("checking pool", pool_id)
            }

            // Creator is creditor (`to`) and will receive funds.
            const tx = await registerObligation(program, counterPartyPubkey, publicKey, amountLamports, pool_id, timestamp);

            const latestBlockhash = await program.provider.connection.getLatestBlockhash();

            await program.provider.connection.confirmTransaction({
                signature: tx,
                ...latestBlockhash,
            });

            toast.success('Позиция создана успешно!')
            navigate('/obligations')
        } catch (error: any) {
            console.error('Error creating obligation:', error)
            toast.error(error.response?.data?.error || 'Ошибка при создании позиции')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <div className="card">
                <h1 style={{ marginBottom: '24px', color: '#333' }}>Создать клиринговую позицию</h1>

                {!publicKey && (
                    <div style={{
                        padding: '16px',
                        background: '#fff3cd',
                        borderRadius: '8px',
                        marginBottom: '24px',
                        color: '#856404'
                    }}>
                        Пожалуйста, подключите кошелек для создания позиции
                    </div>
                )}

                <form onSubmit={handleSubmit}>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <label className="label">
                                Выбрать пользователя из БД
                            </label>
                            <select
                                className="input"
                                value={counterparty}
                                onChange={(e) => handleSelectParticipant(e.target.value)}
                                disabled={participantsLoading}
                                style={{ width: '35vw' }}
                            >
                                <option value="">
                                    {participantsLoading ? 'Загрузка пользователей...' : 'Выберите пользователя'}
                                </option>
                                {availableParticipants.map((participant) => (
                                    <option key={participant.pda} value={participant.authority}>
                                        {participant.user_name} ({participant.authority.slice(0, 8)}...)
                                    </option>
                                ))}
                            </select>
                        </div>

                        ИЛИ

                        <div>
                            <label className="label">
                                Поиск контрагента по имени
                            </label>
                            <div style={{ display: 'flex', alignItems: 'start', gap: '8px' }}>
                                <input
                                    type="text"
                                    className="input"
                                    value={counterpartyName}
                                    onChange={(e) => setCounterpartyName(e.target.value)}
                                    placeholder="Например: ivanov"
                                    style={{ flex: 1, width: '35vw' }}
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleLookupByName}
                                    disabled={lookupLoading || !program}
                                >
                                    {lookupLoading ? 'Поиск...' : 'Найти'}
                                </button>
                            </div>
                        </div>
                    </div>


                    <label className="label">
                        Адрес контрагента (Pubkey)
                    </label>
                    <input
                        type="text"
                        className="input"
                        value={counterparty}
                        onChange={(e) => setCounterparty(e.target.value)}
                        placeholder="Введите адрес Solana кошелька контрагента"
                        required
                    />

                    <div style={{ marginTop: '12px', marginBottom: '12px' }}>
                        <label className="label">Схема обязательства</label>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                flexWrap: 'wrap',
                                padding: '12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                background: '#f8fafc',
                            }}
                        >
                            <div
                                style={{
                                    minWidth: '220px',
                                    maxWidth: '320px',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    background: '#fff',
                                    fontFamily: 'monospace',
                                    fontSize: '13px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={counterparty || 'other participant'}
                            >
                                {counterparty || 'other participant'}
                            </div>
                            <span style={{ color: '#64748b', fontWeight: 600 }}>--</span>
                            <input
                                type="number"
                                step="0.000000001"
                                className="input"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="SOL amount"
                                required
                                min="0"
                                style={{ width: '160px', margin: 0 }}
                            />
                            <span style={{ color: '#64748b', fontWeight: 600 }}>--&gt;</span>
                            <div
                                style={{
                                    minWidth: '220px',
                                    maxWidth: '320px',
                                    padding: '8px 10px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    background: '#fff',
                                    fontFamily: 'monospace',
                                    fontSize: '13px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={publicKey?.toBase58() || 'current participant'}
                            >
                                {publicKey?.toBase58() || 'current participant'}
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading || !publicKey}
                        style={{ width: '100%' }}
                    >
                        {loading ? 'Создание...' : 'Создать позицию'}
                    </button>
                </form>
            </div >
        </div >
    )
}






