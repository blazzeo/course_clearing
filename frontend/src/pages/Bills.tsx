import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { toast } from 'react-toastify'
import { payFee, settle_position, useProgram } from '../api'
import { Bill } from '../interfaces'
import { billNetPositionStatusToRu } from '../statusLabels'
import { useBills } from '../providers/BillsProvider'

function shortPk(pk: PublicKey): string {
    const s = pk.toBase58()
    if (s.length <= 14) return s
    return `${s.slice(0, 6)}…${s.slice(-4)}`
}

export default function Bills() {
    const { publicKey } = useWallet()
    const program = useProgram()
    const { billsOwedByMe, billsOwedToMe, fetchBills, isLoading } = useBills()
    const [processingBill, setProcessingBill] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'owed_by_me' | 'owed_to_me'>('owed_by_me')
    const formatSol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`

    useEffect(() => {
        if (!publicKey || !program) return
        fetchBills()
    }, [publicKey, program, fetchBills])

    const load = async () => {
        if (!publicKey || !program)
            return
        await fetchBills({ force: true })
    }

    const payCommission = async (s: Bill) => {
        if (!publicKey || !program) return toast.error("Подключите кошелек")

        console.log("[Bills] Оплатить комиссию", {
            action: "payFee",
            pda: s.pda.toBase58(),
            session_id: s.session_id,
            debitor: s.debitor.toBase58(),
            creditor: s.creditor.toBase58(),
            net_amount_lamports: s.net_amount,
            fee_amount_lamports: s.fee_amount,
            status: s.status,
            wallet: publicKey.toBase58(),
        })

        try {
            setProcessingBill(s.pda.toBase58())
            await payFee(program, s.session_id, s.creditor)
            toast.success("Комиссия оплачена")
            await load()
        } catch (error) {
            console.error(error)
            toast.error("Ошибка при оплате комиссии")
        } finally {
            setProcessingBill(null)
        }
    }

    const pay = async (s: Bill) => {
        if (!publicKey || !program) return toast.error("Подключите кошелек")

        console.log("[Bills] Оплатить позицию", {
            action: "settlePosition",
            pda: s.pda.toBase58(),
            session_id: s.session_id,
            debitor: s.debitor.toBase58(),
            creditor: s.creditor.toBase58(),
            net_amount_lamports: s.net_amount,
            fee_amount_lamports: s.fee_amount,
            status: s.status,
            wallet: publicKey.toBase58(),
        })

        try {
            setProcessingBill(s.pda.toBase58())
            await settle_position(program, s.session_id, s.creditor, s.net_amount)

            toast.success("Позиция погашена через программу")
            await load()
        } catch (error) {
            console.error(error)
            toast.error("Ошибка при on-chain погашении позиции")
        } finally {
            setProcessingBill(null)
        }
    }

    const tabBarStyle: CSSProperties = {
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid #e0e0e0',
        marginBottom: '16px',
        marginTop: '8px',
    }

    const tabButton = (id: 'owed_by_me' | 'owed_to_me', label: string, count: number): JSX.Element => {
        const active = activeTab === id
        return (
            <button
                type="button"
                onClick={() => setActiveTab(id)}
                style={{
                    fontSize: 15,
                    padding: '12px 20px',
                    border: 'none',
                    borderBottom: active ? '2px solid #667eea' : '2px solid transparent',
                    marginBottom: '-1px',
                    fontWeight: active ? 600 : 400,
                    background: active ? 'rgba(102, 126, 234, 0.08)' : 'transparent',
                    color: active ? '#667eea' : '#555',
                    cursor: 'pointer',
                }}
            >
                {label}
                <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>({count})</span>
            </button>
        )
    }

    const emptyRow = (colSpan: number, text: string) => (
        <tr>
            <td colSpan={colSpan} style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                {text}
            </td>
        </tr>
    )

    return (
        <div className="card">
            <h1>Мои счета</h1>

            {isLoading ? (
                <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
                    Загрузка...
                </p>
            ) : (
                <>
                    <div style={tabBarStyle}>
                        {tabButton('owed_by_me', 'Я должен', billsOwedByMe.length)}
                        {tabButton('owed_to_me', 'Мне должны', billsOwedToMe.length)}
                    </div>

                    {activeTab === 'owed_by_me' && (
                        <>
                            <p style={{ color: '#666', marginBottom: '12px', fontSize: '14px' }}>
                                Вы — должник; оплатите комиссию и погасите позицию.
                            </p>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Сессия</th>
                                        <th>Кому</th>
                                        <th>Сумма</th>
                                        <th>Статус</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {billsOwedByMe.length === 0
                                        ? emptyRow(5, 'Счетов в этой категории нет')
                                        : billsOwedByMe.map((s) => (
                                            <tr key={s.pda.toBase58()}>
                                                <td>#{s.session_id}</td>
                                                <td>
                                                    <Link to={`/participant/${s.creditor.toBase58()}`}>{shortPk(s.creditor)}</Link>
                                                </td>
                                                <td>{formatSol(s.net_amount)}</td>
                                                <td>{billNetPositionStatusToRu(s.status)}</td>
                                                <td>
                                                    {s.debitor.equals(publicKey!) && s.status === 0 && s.fee_amount > 0 && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => payCommission(s)}
                                                            disabled={processingBill === s.pda.toBase58()}
                                                        >
                                                            Оплатить комиссию ({formatSol(s.fee_amount)})
                                                        </button>
                                                    )}
                                                    {s.debitor.equals(publicKey!) && (s.status === 1 || (s.status === 0 && s.fee_amount === 0)) && (
                                                        <button
                                                            className="btn btn-primary"
                                                            onClick={() => pay(s)}
                                                            disabled={processingBill === s.pda.toBase58()}
                                                        >
                                                            Оплатить
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </>
                    )}

                    {activeTab === 'owed_to_me' && (
                        <>
                            <p style={{ color: '#666', marginBottom: '12px', fontSize: '14px' }}>
                                Вы — кредитор; погашение инициирует должник на своей вкладке «Я должен».
                            </p>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Сессия</th>
                                        <th>От кого</th>
                                        <th>Сумма</th>
                                        <th>Статус</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {billsOwedToMe.length === 0
                                        ? emptyRow(4, 'Счетов в этой категории нет')
                                        : billsOwedToMe.map((s) => (
                                            <tr key={s.pda.toBase58()}>
                                                <td>#{s.session_id}</td>
                                                <td>
                                                    <Link to={`/participant/${s.debitor.toBase58()}`}>{shortPk(s.debitor)}</Link>
                                                </td>
                                                <td>{formatSol(s.net_amount)}</td>
                                                <td>{billNetPositionStatusToRu(s.status)}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </>
            )
            }
        </div>
    )
}
