import axios from 'axios'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { API_URL } from '../main'
import { buildCreatePositionByObligationTx, buildFinalizeClearingSessionTx, buildStartClearingSessionTx, createNewPool, createPositionByObligation, finalizeClearingSession, getAllParticipants, getClearingState, getPool, getPoolPda, getUserRole, startClearingSession, updateFeeRate, updateSessionInterval, useProgram, withdrawFee } from '../api'
import { Participant, UserType, UserTypeToString } from '../interfaces'
import { ClipLoader } from 'react-spinners'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

const SECONDS_IN_DAY = 24 * 3600;
const FRESH_RESULT_TTL_SECONDS = 300;

export interface SystemSetting {
    key: string,
    value: number | string,
    description?: string,
}

function formatTimeExtended(seconds: number): string {
    const units = [
        { label: "мес", value: 30 * 24 * 3600 }, // ~30 дней
        { label: "д", value: 24 * 3600 },
        { label: "ч", value: 3600 },
        { label: "мин", value: 60 },
        { label: "с", value: 1 },
    ];

    let result: string[] = [];

    for (const unit of units) {
        const amount = Math.floor(seconds / unit.value);
        if (amount > 0) {
            result.push(`${amount} ${unit.label}`);
            seconds %= unit.value;
        }
    }

    return result.length > 0 ? result.join(" ") : "0 с";
}

export default function AdminPanel() {
    interface ClearingApiResponse {
        success: boolean;
        data?: {
            data: { obligation: string; amount: number }[];
            timestamp: number;
        };
        error?: string;
    }

    const [allUsers, setAllUsers] = useState<Participant[]>([])
    const [systemSettings, setSystemSettings] = useState<SystemSetting[]>([])
    const [loading, setLoading] = useState(true)
    const [isAdmin, setIsAdmin] = useState(false)
    const [checkingAdmin, setCheckingAdmin] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'system'>('users')
    const [newFeeRate, setNewFeeRate] = useState<number>(0)
    const [newIntervalTime, setNewIntervalTime] = useState<number>(0)
    const [withdrawFeeAmount, setWithdrawFeeAmount] = useState<number>(0)
    const [escrowBalance, setEscrowBalance] = useState<number>(0)
    const [poolStats, setPoolStats] = useState<{
        totalPools: number;
        totalSlots: number;
        occupiedSlots: number;
        freeSlots: number;
    } | null>(null)
    const [poolStatsLoading, setPoolStatsLoading] = useState(false)
    const [lastHandledResultTimestamp, setLastHandledResultTimestamp] = useState<number | null>(null)

    const { publicKey, signMessage, signAllTransactions } = useWallet()
    const program = useProgram()

    useEffect(() => {
        checkAdminStatus()
        getEscrowBalance()
        loadPoolStats()
    }, [publicKey])

    const checkAdminStatus = async () => {
        if (!publicKey || !program) {
            setCheckingAdmin(false)
            return
        }

        try {
            let role = await getUserRole(program, publicKey);
            console.log(role)
            if (role == UserType.Administator)
                setIsAdmin(true)
        } catch (error) {
            console.error('Error checking admin status:', error)
            toast.error('Ошибка при проверке прав администратора')
        } finally {
            setCheckingAdmin(false)
        }
    }

    const signAdminRequest = async () => {
        if (!publicKey || !signMessage) {
            throw new Error("Кошелек не найден")
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = `${publicKey.toBase58()}-${timestamp}-${crypto.randomUUID()}`;
        const message = `clear:${timestamp}:${nonce}`;
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await signMessage(encodedMessage);
        const signatureBase64 = btoa(String.fromCharCode(...signature));
        return { message, signature: signatureBase64, nonce, timestamp };
    }

    const isResultFresh = (ts: number): boolean => {
        const now = Math.floor(Date.now() / 1000);
        return Math.abs(now - ts) <= FRESH_RESULT_TTL_SECONDS;
    }

    const executeOnChainAllocations = async (allocations: { obligation: string; amount: number }[]) => {
        if (!publicKey || !program) {
            throw new Error("Кошелек не найден")
        }
        if (signAllTransactions) {
            const state = await getClearingState(program);
            const nextSessionId = state.total_sessions + 1;
            const txs = [];
            txs.push(await buildStartClearingSessionTx(program, allocations.length));
            for (const item of allocations) {
                txs.push(
                    await buildCreatePositionByObligationTx(
                        program,
                        new PublicKey(item.obligation),
                        nextSessionId
                    )
                );
            }
            txs.push(await buildFinalizeClearingSessionTx(program, nextSessionId));

            const latest = await program.provider.connection.getLatestBlockhash();
            txs.forEach((tx) => {
                tx.feePayer = publicKey;
                tx.recentBlockhash = latest.blockhash;
            });

            const signed = await signAllTransactions(txs);
            for (const tx of signed) {
                const sig = await program.provider.connection.sendRawTransaction(tx.serialize());
                await program.provider.connection.confirmTransaction(
                    { signature: sig, ...latest },
                    "confirmed"
                );
            }
        } else {
            await startClearingSession(program, allocations.length);
            for (const item of allocations) {
                await createPositionByObligation(
                    program,
                    new PublicKey(item.obligation)
                );
            }
            await finalizeClearingSession(program);
        }
    }

    const fetchClearingResult = async (endpoint: "run" | "last"): Promise<ClearingApiResponse["data"]> => {
        const payload = await signAdminRequest();
        const res = await axios.post<ClearingApiResponse>(
            `${API_URL}/clearing/${endpoint}`,
            payload,
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
        if (!res.data.success || !res.data.data) {
            throw new Error(res.data.error || "Clearing API returned empty response");
        }
        return res.data.data;
    }

    const executeClearingHandler = async () => {
        if (!publicKey || !program || !signMessage) {
            toast.error("Кошелек не найден")
            return
        }

        try {
            setActionLoading(true)

            const result = await fetchClearingResult("run");
            if (lastHandledResultTimestamp !== null && result.timestamp <= lastHandledResultTimestamp) {
                toast.info("Новой сессии не было");
                return;
            }
            if (!isResultFresh(result.timestamp)) {
                toast.warn("Результат клиринга устарел. Запусти клиринг повторно.");
                return;
            }
            await executeOnChainAllocations(result.data);
            setLastHandledResultTimestamp(result.timestamp);

            toast.success(`Клиринг завершен. Обработано обязательств: ${result.data.length}`);
        } catch (error) {
            console.error('Error executing clearing:', error)
            toast.error('Ошибка при проведении операции')
        } finally {
            setActionLoading(false)
        }
    }

    const executeLastSessionResultHandler = async () => {
        if (!publicKey || !program || !signMessage) {
            toast.error("Кошелек не найден")
            return
        }

        try {
            setActionLoading(true)
            const result = await fetchClearingResult("last");

            if (lastHandledResultTimestamp !== null && result.timestamp <= lastHandledResultTimestamp) {
                toast.info("Новой сессии не было");
                return;
            }
            if (!result.data.length) {
                toast.info("Новой сессии не было");
                return;
            }
            if (!isResultFresh(result.timestamp)) {
                toast.info("Новой сессии не было");
                return;
            }

            await executeOnChainAllocations(result.data);
            setLastHandledResultTimestamp(result.timestamp);
            toast.success(`Обработан последний результат сессии. Обязательств: ${result.data.length}`);
        } catch (error) {
            console.error('Error executing last session result:', error)
            toast.error('Ошибка при обработке последнего результата')
        } finally {
            setActionLoading(false)
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
            console.log("participants: ", participants)
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

            const info = await getClearingState(program)

            const feeRateSetting: SystemSetting = {
                key: 'Fee Rate (%)',
                value: info.fee_rate_bps / 100,
                description: 'Процент комиссии от сделки'
            }

            const sessionIntervalSetting: SystemSetting = {
                key: 'Session Interval Time (д)',
                value: formatTimeExtended(info.session_interval_time),
                description: 'Интервал времени между сессиями клиринга'
            }

            setSystemSettings([feeRateSetting, sessionIntervalSetting])
        } catch (error) {
            console.error('Error loading settings:', error)
            toast.error('Ошибка при загрузке системных настроек')
        } finally {
            setLoading(false)
        }
    }

    const updateFeeRateHandler = async () => {
        if (!publicKey || !program) {
            toast.error('Кошелек не найден');
            return;
        }

        try {
            setActionLoading(true);
            // Конвертируем проценты обратно в BPS (например, 0.5% -> 50 BPS)
            const bpsValue = Math.round(newFeeRate * 100);

            console.log('new fee: ', newFeeRate)
            console.log('bps: ', bpsValue)

            await updateFeeRate(program, bpsValue);

            toast.success(`Комиссия обновлена до ${newFeeRate}% (${bpsValue} BPS)`);
            loadSystemSettings();
        } catch (error) {
            console.error('Error updating fee rate:', error);
            toast.error('Ошибка при обновлении комиссии');
        } finally {
            setActionLoading(false);
        }
    }

    const updateSessionIntervalTimeHandler = async () => {
        if (!publicKey || !program) {
            toast.error('Кошелёк не найден')
            return;
        }

        const secondsToUpdate = newIntervalTime * SECONDS_IN_DAY;

        try {
            setActionLoading(true)

            await updateSessionInterval(program, secondsToUpdate)

            toast.success('Интервал сессий успешно обновлен')
            await loadSystemSettings()
        } catch (error) {
            console.error('Error updating session interval: ', error)
            toast.error('Ошибка при обновлении интервала сессий')
        } finally {
            setActionLoading(false)
        }
    }

    const getEscrowBalance = async () => {
        if (!program) return;

        try {
            const [escrowPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("escrow")],
                program.programId
            );

            // 1. Получаем данные аккаунта (десериализация через Anchor)
            const escrowAccount = await program.account.escrow.fetch(escrowPda);

            // 2. Берем именно поле total_fees (оно в BN, так что переводим в число)
            const feesLamports = escrowAccount.totalFees.toNumber();
            const feesSol = feesLamports / LAMPORTS_PER_SOL;

            console.log(`Накоплено комиссий: ${feesSol} SOL`);
            setEscrowBalance(feesSol);

        } catch (error) {
            console.error("Ошибка при получении данных эскроу:", error);
            // Если аккаунт еще не создан (не было ни одной сделки), fetch выдаст ошибку
            setEscrowBalance(0);
        }
    }

    const getLastPoolId = async (): Promise<number> => {
        if (!program) throw new Error("Program is not initialized")

        let poolId = 0;
        while (true) {
            const poolPda = getPoolPda(program, poolId);
            const pool = await getPool(program, poolPda);
            if (!pool) {
                if (poolId === 0) {
                    throw new Error("Root pool not found. Create pool manager first.");
                }
                return poolId - 1;
            }
            poolId += 1;
            if (poolId > 1024) {
                throw new Error("Pool scan limit reached");
            }
        }
    }

    const loadPoolStats = async () => {
        if (!program) return;
        setPoolStatsLoading(true);
        try {
            let poolId = 0;
            let totalPools = 0;
            let occupiedSlots = 0;
            let slotsPerPool = 50; // fallback for UI

            while (true) {
                const poolPda = getPoolPda(program, poolId);
                const pool = await getPool(program, poolPda);
                if (!pool) break;

                totalPools += 1;
                const occupied = Number(pool.occupiedCount?.toString?.() ?? pool.occupiedCount ?? 0);
                occupiedSlots += occupied;

                const obligations = pool.obligations as unknown[];
                if (Array.isArray(obligations) && obligations.length > 0) {
                    slotsPerPool = obligations.length;
                }

                poolId += 1;
                if (poolId > 1024) break;
            }

            const totalSlots = totalPools * slotsPerPool;
            const freeSlots = Math.max(totalSlots - occupiedSlots, 0);

            setPoolStats({
                totalPools,
                totalSlots,
                occupiedSlots,
                freeSlots,
            });
        } catch (error) {
            console.error('Error loading pool stats:', error);
            setPoolStats(null);
        } finally {
            setPoolStatsLoading(false);
        }
    }

    const createNewPoolHandler = async () => {
        if (!publicKey || !program) {
            toast.error('Кошелёк не найден')
            return;
        }

        try {
            setActionLoading(true)
            const lastPoolId = await getLastPoolId();
            await createNewPool(program, lastPoolId);
            toast.success(`Новый пул #${lastPoolId + 1} создан`);
            await loadPoolStats();
        } catch (error) {
            console.error('Error creating new pool:', error)
            toast.error('Ошибка при создании нового пула')
        } finally {
            setActionLoading(false)
        }
    }

    const withdrawFeeHandler = async () => {
        if (!publicKey || !program) {
            toast.error('Кошелёк не найден')
            return;
        }

        try {
            setActionLoading(true)

            console.log(withdrawFeeAmount)

            await withdrawFee(program, withdrawFeeAmount * LAMPORTS_PER_SOL)

            toast.success('Комиссия выведена')
        } catch (error) {
            console.error('Error withdrawing fee: ', error)
            toast.error('Ошибка при выводе комиссий')
        } finally {
            setActionLoading(false)
        }
    }

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
                        Список пользователей
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
                    {/* Список всех пользователей */}
                    <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px' }}>Все пользователи системы</h3>
                        {loading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', padding: "40px 0", alignItems: "center", justifyContent: "center" }}>
                                <ClipLoader size={56} speedMultiplier={0.7} />
                                <p>Загрузка...</p>
                            </div>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allUsers.map((user) => (
                                            <tr key={user.authority.toBase58()} style={{ borderBottom: '1px solid #eee' }}>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                                                    <Link to={`/participant/${user.authority.toBase58()}`}>{user.authority.toBase58()}</Link>
                                                </td>
                                                <td style={{ padding: '12px' }}>
                                                    {UserTypeToString(user.userType)}
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
                    <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <h3 style={{ marginBottom: '16px', padding: '20px 20px 0 20px', color: '#333' }}>Системные настройки</h3>
                        {loading ? (
                            <div style={{ padding: '20px', color: '#333' }}>Загрузка...</div>
                        ) : systemSettings.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                                Настроек пока нет
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f5f5f5', color: '#333' }}>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Ключ</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Значение</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Описание</th>
                                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Действие</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {systemSettings.map((setting) => (
                                            <tr key={setting.key} style={{ borderBottom: '1px solid #eee', color: '#333' }}>
                                                <td style={{ padding: '12px', fontWeight: 'bold' }}>{setting.key}</td>
                                                <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '14px' }}>
                                                    {setting.value}
                                                </td>
                                                <td style={{ padding: '12px' }}>{setting.description || '-'}</td>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>

                                                        {setting.key === 'Fee Rate (%)' ? (
                                                            /* Ввод в процентах */
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <input
                                                                    type="number"
                                                                    step="0.01" // Позволяет вводить дробные проценты, например 0.25%
                                                                    placeholder="Напр: 0.5"
                                                                    style={{
                                                                        padding: '6px',
                                                                        width: '80px',
                                                                        borderRadius: '4px',
                                                                        border: '1px solid #ccc'
                                                                    }}
                                                                    onChange={(e) => setNewFeeRate(parseFloat(e.target.value) || 0)}
                                                                />
                                                                <span style={{ fontSize: '14px', color: '#666' }}>%</span>
                                                            </div>
                                                        ) : setting.key === 'Session Interval Time (д)' ? (
                                                            /* Ваш текущий блок для дней (из предыдущего шага) */
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    max="30"
                                                                    style={{ padding: '6px', width: '60px', borderRadius: '4px', border: '1px solid #ccc' }}
                                                                    onChange={(e) => setNewIntervalTime(parseInt(e.target.value) || 0)}
                                                                />
                                                                <span style={{ fontSize: '14px', color: '#666' }}>дн.</span>
                                                            </div>
                                                        ) : null}

                                                        <button
                                                            onClick={() => {
                                                                if (setting.key === 'Fee Rate (%)') updateFeeRateHandler();
                                                                if (setting.key === 'Session Interval Time (д)') updateSessionIntervalTimeHandler();
                                                            }}
                                                            disabled={actionLoading}
                                                            style={{
                                                                padding: '6px 12px',
                                                                background: actionLoading ? '#ccc' : '#667eea',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: actionLoading ? 'not-allowed' : 'pointer'
                                                            }}
                                                        >
                                                            Обновить
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

            {/* System Actions Tab */}
            {
                activeTab === 'system' && (
                    <div>
                        <div style={{ display: 'grid', gap: '24px' }}>
                            {/* Запуск клиринга */}
                            <div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                                <h3 style={{ marginBottom: '16px' }}>Запуск процедуры клиринга</h3>
                                <p style={{ marginBottom: '16px', color: '#666' }}>
                                    Эта операция проведет неттинг всех подтвержденных позиций и создаст транзакции для расчетов.
                                </p>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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
                                    <button
                                        onClick={executeLastSessionResultHandler}
                                        disabled={actionLoading}
                                        style={{
                                            padding: '12px 24px',
                                            background: actionLoading ? '#ccc' : '#667eea',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: actionLoading ? 'not-allowed' : 'pointer',
                                            fontSize: '16px',
                                            fontWeight: 'bold'
                                        }}
                                    >
                                        {actionLoading ? 'Проверка last result...' : 'Получить last session result'}
                                    </button>
                                </div>
                            </div>

                            {/* Вывод комиссий */}
                            <div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                                <h3 style={{ marginBottom: '16px' }}>Вывод комиссий</h3>
                                <p style={{ marginBottom: '16px', color: '#666' }}>
                                    Эта операция снимет выбранную сумму комиссий со счёта программы.
                                </p>

                                <p style={{ marginBottom: '16px', color: '#666' }}>
                                    На счету: <span style={{ fontWeight: 'bold', color: 'blue' }}>{escrowBalance} SOL</span>
                                </p>

                                <input
                                    type="number"
                                    step="0.01" // Позволяет вводить дробные проценты, например 0.25%
                                    placeholder="Введите сумму"
                                    max={escrowBalance}
                                    min={0}
                                    style={{
                                        padding: '12px',
                                        width: '140px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc'
                                    }}
                                    onChange={(e) => setWithdrawFeeAmount(parseFloat(e.target.value) || 0)}
                                />
                                <button
                                    onClick={withdrawFeeHandler}
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
                                    {actionLoading ? 'Вывод средств...' : 'Вывести средства'}
                                </button>
                            </div>

                            {/* Создание нового пула */}
                            <div style={{ padding: '24px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white' }}>
                                <h3 style={{ marginBottom: '16px' }}>Создать новый пул обязательств</h3>
                                <p style={{ marginBottom: '16px', color: '#666' }}>
                                    Используйте это действие, когда существующие пулы заполнены.
                                </p>
                                {poolStatsLoading ? (
                                    <p style={{ color: '#666', marginBottom: '12px' }}>Загрузка статистики пулов...</p>
                                ) : poolStats ? (
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#333' }}>
                                            <span>Пулы: {poolStats.totalPools}</span>
                                            <span>Свободно: {poolStats.freeSlots} / {poolStats.totalSlots}</span>
                                        </div>
                                        <div style={{ width: '100%', background: '#e9ecef', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
                                            <div
                                                style={{
                                                    width: `${poolStats.totalSlots > 0 ? (poolStats.occupiedSlots / poolStats.totalSlots) * 100 : 0}%`,
                                                    background: poolStats.freeSlots > 0 ? '#ff9800' : '#e53935',
                                                    height: '100%',
                                                    transition: 'width 0.3s ease'
                                                }}
                                            />
                                        </div>
                                        <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                                            Занято: {poolStats.occupiedSlots} | Свободно: {poolStats.freeSlots}
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ color: '#666', marginBottom: '12px' }}>Не удалось загрузить статистику пулов</p>
                                )}
                                <button
                                    onClick={createNewPoolHandler}
                                    disabled={actionLoading}
                                    style={{
                                        padding: '12px 24px',
                                        background: actionLoading ? '#ccc' : '#667eea',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: actionLoading ? 'not-allowed' : 'pointer',
                                        fontSize: '16px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    {actionLoading ? 'Создание пула...' : 'Создать новый пул'}
                                </button>
                            </div>

                        </div>
                    </div>
                )

            }

        </div >
    )
}
