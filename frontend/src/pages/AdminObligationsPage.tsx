import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { getAllObligationsFromDb } from "../api";
import { Obligation, ObligationStatus } from "../interfaces";
import { API_URL } from "../main";
import { MapObligationStatus } from "./ObligationsPage";

function csvEscape(value: string | number | null | undefined): string {
    const s = value == null ? "" : String(value);
    return `"${s.replace(/"/g, "\"\"")}"`;
}

export default function AdminObligationsPage() {
    const [items, setItems] = useState<Obligation[]>([]);
    const [loading, setLoading] = useState(false);
    const [walletFilter, setWalletFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<ObligationStatus>(ObligationStatus.All);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 15;

    const load = async () => {
        try {
            setLoading(true);
            setItems(await getAllObligationsFromDb(API_URL));
        } catch (error) {
            console.error("Error loading all obligations:", error);
            toast.error("Не удалось загрузить обязательства");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        setPage(1);
    }, [walletFilter, statusFilter, dateFrom, dateTo]);

    const formatDate = (date: number | null) => {
        if (!date) return "-";
        const tsMs = date < 1_000_000_000_000 ? date * 1000 : date;
        return new Date(tsMs).toLocaleString("ru-RU");
    };

    const formatOperationalDay = (dayTs?: number) => {
        if (!dayTs) return "-";
        return new Date(dayTs * 1000).toLocaleDateString("ru-RU");
    };

    const getStatusClass = (status: ObligationStatus) => {
        switch (status) {
            case ObligationStatus.Created:
                return "status-badge status-pending";
            case ObligationStatus.Confirmed:
            case ObligationStatus.PartiallyNetted:
                return "status-badge status-confirmed";
            case ObligationStatus.Netted:
                return "status-badge status-cleared";
            default:
                return "status-badge";
        }
    };

    const filtered = useMemo(() => {
        const wallet = walletFilter.trim();
        const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() / 1000 : null;
        const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() / 1000 : null;
        return items.filter((o) => {
            if (statusFilter !== ObligationStatus.All && o.status !== statusFilter) return false;
            if (wallet) {
                const from = o.from.toBase58();
                const to = o.to.toBase58();
                if (!from.includes(wallet) && !to.includes(wallet)) return false;
            }
            if (fromTs && o.timestamp < fromTs) return false;
            if (toTs && o.timestamp > toTs) return false;
            return true;
        });
    }, [items, walletFilter, statusFilter, dateFrom, dateTo]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageSafe = Math.min(page, totalPages);
    const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

    const exportCsv = () => {
        const headers = [
            "pda",
            "from",
            "to",
            "status",
            "remaining_amount_lamports",
            "original_amount_lamports",
            "created_at_unix",
        ];
        const rows = filtered.map((o) => [
            o.pda.toBase58(),
            o.from.toBase58(),
            o.to.toBase58(),
            MapObligationStatus(o.status),
            o.amount,
            o.originalAmount ?? "",
            o.timestamp,
        ]);
        const csv = [headers, ...rows]
            .map((row) => row.map((x) => csvEscape(x as string | number | null | undefined)).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `admin_obligations_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="card">
            <h1>Все обязательства</h1>
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
                    placeholder="Фильтр по кошельку (from/to)"
                    value={walletFilter}
                    onChange={(e) => setWalletFilter(e.target.value)}
                    style={{ minWidth: "260px" }}
                />
                <select
                    className="input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(Number(e.target.value))}
                    style={{ minWidth: "220px" }}
                >
                    <option value={ObligationStatus.All}>Все статусы</option>
                    <option value={ObligationStatus.Created}>Created</option>
                    <option value={ObligationStatus.Confirmed}>Confirmed</option>
                    <option value={ObligationStatus.PartiallyNetted}>PartiallyNetted</option>
                    <option value={ObligationStatus.Netted}>Netted</option>
                    <option value={ObligationStatus.Declined}>Declined</option>
                    <option value={ObligationStatus.Cancelled}>Cancelled</option>
                </select>
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {loading ? (
                <p style={{ color: "#666" }}>Загрузка...</p>
            ) : filtered.length === 0 ? (
                <p style={{ color: "#666", textAlign: "center", padding: "24px" }}>Обязательства не найдены</p>
            ) : (
                <>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Debitor</th>
                                <th>Creditor</th>
                                <th>Сумма (остаток / номинал)</th>
                                <th>Статус</th>
                                <th>Создано</th>
                                <th>Опер. день расчета</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageItems.map((o) => (
                                <tr key={o.pda.toBase58()}>
                                    <td><Link to={`/participant/${o.from.toBase58()}`}>{o.from.toBase58().slice(0, 8)}...</Link></td>
                                    <td><Link to={`/participant/${o.to.toBase58()}`}>{o.to.toBase58().slice(0, 8)}...</Link></td>
                                    <td>
                                        {(o.amount / 1e9).toFixed(4)}
                                        {o.originalAmount != null ? ` / ${(o.originalAmount / 1e9).toFixed(4)}` : ""}
                                        {" "}SOL
                                    </td>
                                    <td><span className={getStatusClass(o.status)}>{MapObligationStatus(o.status)}</span></td>
                                    <td>{formatDate(o.timestamp)}</td>
                                    <td>{formatOperationalDay(o.expectingOperationalDay)}</td>
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
