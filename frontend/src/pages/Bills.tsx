import { useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'react-toastify'
import { payFee, settle_position, useProgram } from '../api'
import { Bill } from '../interfaces'
import { useBills } from '../providers/BillsProvider'

export default function Bills() {
    const { publicKey } = useWallet()
    const program = useProgram()
    const { bills: settlements, fetchBills, isLoading } = useBills()
    const [processingBill, setProcessingBill] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'payables' | 'receivables'>('payables')
    const formatSol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`

    const groupedBills = useMemo(() => {
        if (!publicKey) {
            return { receivables: [] as Bill[], payables: [] as Bill[] }
        }
        return {
            receivables: settlements.filter((bill) => bill.creditor.equals(publicKey)),
            payables: settlements.filter((bill) => bill.debitor.equals(publicKey)),
        }
    }, [settlements, publicKey])

    useEffect(() => {
        if (!publicKey || !program) return
        fetchBills()
    }, [publicKey, program, fetchBills])

    const load = async () => {
        if (!publicKey || !program)
            return

        await fetchBills()
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

    if (!publicKey)
        return <h1 style={{ color: '#eee' }}>Подключите кошелёк</h1>

    const renderBillsTable = (
        title: string,
        items: Bill[],
        emptyText: string,
        mode: 'receivables' | 'payables',
    ) => (
        <div style={{ marginTop: '24px' }}>
            <h2 style={{ color: '#333', marginBottom: '12px' }}>{title}</h2>
            {items.length === 0 ? (
                <p style={{ color: '#666', padding: '16px 0' }}>{emptyText}</p>
            ) : (
                <table className="table">
                    <thead>
                        <tr>
                            <th>{mode === 'receivables' ? 'Дебитор (контрагент)' : 'Кредитор (контрагент)'}</th>
                            <th>Сумма</th>
                            <th>Статус</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((s) => (
                            <tr key={s.pda.toBase58()}>
                                <td>
                                    {(mode === 'receivables' ? s.debitor : s.creditor).toBase58().slice(0, 8)}...
                                </td>
                                <td>{formatSol(s.net_amount)}</td>
                                <td>{s.status === 2 ? "Оплачено" : "Не оплачено"}</td>
                                <td>
                                    {s.debitor.equals(publicKey) && s.status === 0 && s.fee_amount > 0 && (
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => payCommission(s)}
                                            disabled={processingBill === s.pda.toBase58()}
                                        >
                                            Оплатить комиссию ({formatSol(s.fee_amount)})
                                        </button>
                                    )}
                                    {s.debitor.equals(publicKey) && (s.status === 1 || (s.status === 0 && s.fee_amount === 0)) && (
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
            )}
        </div>
    )

    return (
        <div className="card">
            <h1>Мои счета</h1>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                    type="button"
                    className={viewMode === 'payables' ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => setViewMode('payables')}
                >
                    Я должен
                </button>
                <button
                    type="button"
                    className={viewMode === 'receivables' ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => setViewMode('receivables')}
                >
                    Мне должны
                </button>
            </div>

            {isLoading ? (
                <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
                    Загрузка...
                </p>
            ) : settlements.length === 0 ? (
                <p style={{ color: '#666', textAlign: 'center', padding: '32px' }}>
                    Счета не найдены
                </p>
            ) : (
                <>
                    {viewMode === 'payables'
                        ? renderBillsTable('Я должен', groupedBills.payables, 'Нет счетов, где вы должны контрагенту', 'payables')
                        : renderBillsTable('Мне должны', groupedBills.receivables, 'Нет счетов, где контрагент должен вам', 'receivables')}
                </>
            )
            }
        </div>
    )
}
