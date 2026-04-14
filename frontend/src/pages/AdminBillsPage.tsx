import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { getAllBills, listClearingSessions, useProgram } from "../api";
import { Bill } from "../interfaces";
import { API_URL } from "../main";

function csvEscape(value: string | number | null | undefined): string {
    const s = value == null ? "" : String(value);
    return `"${s.replace(/"/g, "\"\"")}"`;
}

function billStatusLabel(status: number): string {
    if (status === 2) return "Оплачено";
    if (status === 1) return "Комиссия оплачена";
    return "Ожидает оплаты";
}

export default function AdminBillsPage() {
    const program = useProgram();
    const [items, setItems] = useState<Bill[]>([]);
    const [sessionCreatedAt, setSessionCreatedAt] = useState<Record<number, number>>({});
    const [loading, setLoading] = useState(false);
    const [walletFilter, setWalletFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<number>(-1);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 15;

    const load = async () => {
        if (!program) return;
        try {
            setLoading(true);
            const all = await getAllBills(program);
            all.sort((a, b) => b.session_id - a.session_id);
            setItems(all);
            const sessions = await listClearingSessions(API_URL);
            const map: Record<number, number> = {};
            for (const s of sessions) {
                map[s.session_id] = s.created_at;
            }
            setSessionCreatedAt(map);
        } catch (error) {
            console.error("Error loading all bills:", error);
            toast.error("Не удалось загрузить счета");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [program]);

    useEffect(() => {
        setPage(1);
    }, [walletFilter, statusFilter, dateFrom, dateTo]);

    const filtered = useMemo(() => {
        const wallet = walletFilter.trim();
        const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() / 1000 : null;
        const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() / 1000 : null;
        return items.filter((s) => {
            if (statusFilter !== -1 && s.status !== statusFilter) return false;
            if (wallet) {
                const d = s.debitor.toBase58();
                const c = s.creditor.toBase58();
                if (!d.includes(wallet) && !c.includes(wallet)) return false;
            }
            const createdAt = sessionCreatedAt[s.session_id];
            if (fromTs && createdAt && createdAt < fromTs) return false;
            if (toTs && createdAt && createdAt > toTs) return false;
            return true;
        });
    }, [items, walletFilter, statusFilter, dateFrom, dateTo, sessionCreatedAt]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageSafe = Math.min(page, totalPages);
    const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

    const exportCsv = () => {
        const headers = [
            "position_pda",
            "session_id",
            "session_created_at_unix",
            "debitor",
            "creditor",
            "net_amount_lamports",
            "fee_amount_lamports",
            "status_code",
            "status_label",
        ];
        const rows = filtered.map((s) => [
            s.pda.toBase58(),
            s.session_id,
            sessionCreatedAt[s.session_id] ?? "",
            s.debitor.toBase58(),
            s.creditor.toBase58(),
            s.net_amount,
            s.fee_amount,
            s.status,
            billStatusLabel(s.status),
        ]);
        const csv = [headers, ...rows]
            .map((row) => row.map((x) => csvEscape(x as string | number | null | undefined)).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `admin_bills_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="card">
            <h1>Все счета</h1>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button className="btn btn-primary" onClick={load} disabled={loading}>
                    {loading ? "Обновление..." : "Обновить список"}
                </button>
                <button className="btn btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
                    Экспорт CSV
                </button>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                <input
                    className="input"
                    placeholder="Фильтр по кошельку (debitor/creditor)"
                    value={walletFilter}
                    onChange={(e) => setWalletFilter(e.target.value)}
                    style={{ minWidth: "280px" }}
                />
                <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(Number(e.target.value))}>
                    <option value={-1}>Все статусы</option>
                    <option value={0}>Ожидает оплаты</option>
                    <option value={1}>Комиссия оплачена</option>
                    <option value={2}>Оплачено</option>
                </select>
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {loading ? (
                <p style={{ color: "#666" }}>Загрузка...</p>
            ) : filtered.length === 0 ? (
                <p style={{ color: "#666", textAlign: "center", padding: "24px" }}>Счета не найдены</p>
            ) : (
                <>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Session</th>
                                <th>Debitor</th>
                                <th>Creditor</th>
                                <th>Net</th>
                                <th>Fee</th>
                                <th>Статус</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageItems.map((s) => (
                                <tr key={s.pda.toBase58()}>
                                    <td>#{s.session_id}</td>
                                    <td><Link to={`/participant/${s.debitor.toBase58()}`}>{s.debitor.toBase58().slice(0, 8)}...</Link></td>
                                    <td><Link to={`/participant/${s.creditor.toBase58()}`}>{s.creditor.toBase58().slice(0, 8)}...</Link></td>
                                    <td>{(s.net_amount / 1e9).toFixed(4)} SOL</td>
                                    <td>{(s.fee_amount / 1e9).toFixed(4)} SOL</td>
                                    <td>{billStatusLabel(s.status)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                        <span style={{ color: "#666" }}>Найдено: {filtered.length}</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <button className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Назад</button>
                            <span>Стр. {pageSafe} / {totalPages}</span>
                            <button className="btn btn-secondary" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Вперед</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
