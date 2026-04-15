import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getClearingSessionPayload, listClearingSessions } from "../api";
import { ClearingAuditResult, ClearingSessionSummary } from "../interfaces";
import { API_URL } from "../main";
import SessionVisualization from "../components/SessionVisualization";

const shortKey = (value?: string | null) => {
    if (!value) return "n/a";
    if (value.length <= 14) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
};
const fmtSol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`;
const fmtTs = (ts: number) => new Date(ts * 1000).toLocaleString("ru-RU");
function csvEscape(value: string | number | null | undefined): string {
    const s = value == null ? "" : String(value);
    return `"${s.replace(/"/g, "\"\"")}"`;
}

function renderSessionDetails(audit: ClearingAuditResult) {
    return (
        <div style={{ marginTop: "10px", fontSize: "13px", color: "#333", display: "grid", gap: "10px" }}>
            <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "8px" }}>
                <div><b>Result hash:</b> <span style={{ fontFamily: "monospace" }}>{audit.hash}</span></div>
                <div><b>Merkle root:</b> <span style={{ fontFamily: "monospace" }}>{audit.merkle_root || "-"}</span></div>
                <div><b>Solver:</b> {audit.solver_version || "n/a"} | <b>Build:</b> {audit.build_sha || "n/a"}</div>
                <div><b>Allocator mode:</b> {audit.allocator_mode || "n/a"}</div>
                {audit.fallback_reason ? <div><b>Fallback reason:</b> {audit.fallback_reason}</div> : null}
                {audit.flow_objective ? <div><b>Flow objective:</b> {audit.flow_objective}</div> : null}
                {audit.flow_total_cost != null ? <div><b>Flow total cost:</b> {audit.flow_total_cost}</div> : null}
                {audit.flow_unmet_demand != null ? <div><b>Flow unmet demand:</b> {audit.flow_unmet_demand}</div> : null}
                <div><b>Created:</b> {fmtTs(audit.timestamp)}</div>
            </div>

            {!!audit.input_obligations?.length && (
                <details>
                    <summary style={{ cursor: "pointer" }}>Входные обязательства ({audit.input_obligations.length})</summary>
                    <table style={{ width: "100%", marginTop: "6px", borderCollapse: "collapse" }}>
                        <thead><tr><th>Obligation</th><th>From</th><th>To</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>
                            {audit.input_obligations.map((x) => (
                                <tr key={x.obligation}>
                                    <td>{shortKey(x.obligation)}</td>
                                    <td>{shortKey(x.from)}</td>
                                    <td>{shortKey(x.to)}</td>
                                    <td>{fmtSol(x.amount)}</td>
                                    <td>{x.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>
            )}

            <details>
                <summary style={{ cursor: "pointer" }}>External allocations ({audit.data.length})</summary>
                <ul>
                    {audit.data.map((x) => (
                        <li key={`ex-${x.from}-${x.to}-${x.amount}`}>
                            {shortKey(x.from)} → {shortKey(x.to)}: {fmtSol(x.amount)}
                        </li>
                    ))}
                </ul>
            </details>

            <details>
                <summary style={{ cursor: "pointer" }}>Internal nettings ({audit.internal_data.length})</summary>
                <ul>
                    {audit.internal_data.map((x) => {
                        const applied = Number(x.flow_used ?? 0);
                        const residual = Number(x.amount ?? 0);
                        const text =
                            applied > 0
                                ? `списание ${fmtSol(applied)}, остаток в плане ${fmtSol(residual)}`
                                : `без списания в сессии (остаток в плане ${fmtSol(residual)})`;
                        return (
                            <li key={`in-${x.obligation}`}>
                                {shortKey(x.obligation)}: {text}
                            </li>
                        );
                    })}
                </ul>
            </details>

            <details>
                <summary style={{ cursor: "pointer" }}>Audit timeline ({audit.audit_log.length})</summary>
                <ul>
                    {audit.audit_log.map((entry, idx) => (
                        <li key={`${entry.step}-${idx}`}>
                            <b>{entry.step}</b> [{fmtTs(entry.timestamp)}]: {entry.detail}
                        </li>
                    ))}
                </ul>
            </details>

            <details>
                <summary style={{ cursor: "pointer" }}>Визуальный граф и Merkle tree</summary>
                <div style={{ marginTop: "8px" }}>
                    <SessionVisualization audit={audit} />
                </div>
            </details>
        </div>
    );
}

export default function AdminSessionsPage() {
    const [sessions, setSessions] = useState<ClearingSessionSummary[]>([]);
    const [expandedSessions, setExpandedSessions] = useState<Record<number, ClearingAuditResult>>({});
    const [openedSessionIds, setOpenedSessionIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [walletFilter, setWalletFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "has_external" | "has_internal" | "empty">("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 10;

    const loadSessions = async () => {
        try {
            setLoading(true);
            setSessions(await listClearingSessions(API_URL));
        } catch (error) {
            console.error("Error loading clearing sessions:", error);
            toast.error("Не удалось загрузить историю сессий");
        } finally {
            setLoading(false);
        }
    };

    const openSession = async (sessionId: number) => {
        if (expandedSessions[sessionId]) return;
        try {
            const payload = await getClearingSessionPayload(API_URL, sessionId);
            setExpandedSessions((prev) => ({ ...prev, [sessionId]: payload }));
        } catch (error) {
            console.error(`Error loading session payload #${sessionId}:`, error);
            toast.error(`Не удалось загрузить сессию #${sessionId}`);
        }
    };

    const ensurePayloadLoaded = async (sessionId: number) => {
        if (expandedSessions[sessionId]) return expandedSessions[sessionId];
        const payload = await getClearingSessionPayload(API_URL, sessionId);
        setExpandedSessions((prev) => ({ ...prev, [sessionId]: payload }));
        return payload;
    };

    const toggleSession = async (sessionId: number) => {
        const isOpen = openedSessionIds.has(sessionId);
        if (isOpen) {
            setOpenedSessionIds((prev) => {
                const next = new Set(prev);
                next.delete(sessionId);
                return next;
            });
            return;
        }

        if (!expandedSessions[sessionId]) {
            await openSession(sessionId);
        }
        setOpenedSessionIds((prev) => {
            const next = new Set(prev);
            next.add(sessionId);
            return next;
        });
    };

    useEffect(() => {
        loadSessions();
    }, []);

    useEffect(() => {
        setPage(1);
    }, [walletFilter, statusFilter, dateFrom, dateTo]);

    const [walletMatchedIds, setWalletMatchedIds] = useState<Set<number> | null>(null);
    useEffect(() => {
        const w = walletFilter.trim();
        if (!w) {
            setWalletMatchedIds(null);
            return;
        }
        let cancelled = false;
        (async () => {
            const matched = new Set<number>();
            for (const s of sessions) {
                try {
                    const payload = await ensurePayloadLoaded(s.session_id);
                    const haystack = [
                        ...(payload.input_obligations?.flatMap((o) => [o.obligation, o.from, o.to]) || []),
                        ...payload.data.map((x) => x.obligation),
                        ...payload.internal_data.map((x) => x.obligation),
                    ].join(" ");
                    if (haystack.includes(w)) matched.add(s.session_id);
                } catch {
                    // ignore broken payload for filter
                }
            }
            if (!cancelled) setWalletMatchedIds(matched);
        })();
        return () => {
            cancelled = true;
        };
    }, [walletFilter, sessions]);

    const filtered = useMemo(() => {
        const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() / 1000 : null;
        const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() / 1000 : null;
        return sessions.filter((s) => {
            if (statusFilter === "has_external" && s.external_count <= 0) return false;
            if (statusFilter === "has_internal" && s.internal_count <= 0) return false;
            if (statusFilter === "empty" && (s.external_count > 0 || s.internal_count > 0)) return false;
            if (fromTs && s.created_at < fromTs) return false;
            if (toTs && s.created_at > toTs) return false;
            if (walletFilter.trim() && walletMatchedIds && !walletMatchedIds.has(s.session_id)) return false;
            return true;
        });
    }, [sessions, statusFilter, dateFrom, dateTo, walletFilter, walletMatchedIds]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageSafe = Math.min(page, totalPages);
    const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

    const exportCsv = () => {
        const headers = [
            "session_id",
            "result_id",
            "result_hash",
            "merkle_root",
            "external_count",
            "internal_count",
            "created_at_unix",
        ];
        const rows = filtered.map((s) => [
            s.session_id,
            s.result_id,
            s.result_hash,
            s.merkle_root,
            s.external_count,
            s.internal_count,
            s.created_at,
        ]);
        const csv = [headers, ...rows]
            .map((row) => row.map((x) => csvEscape(x as string | number | null | undefined)).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `admin_sessions_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="card">
            <h1>Сессии клиринга</h1>
            <p style={{ color: "#555", marginBottom: "12px" }}>
                История сессий и их payload из backend API.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                <input
                    className="input"
                    placeholder="Фильтр по кошельку/obligation (в payload)"
                    value={walletFilter}
                    onChange={(e) => setWalletFilter(e.target.value)}
                    style={{ minWidth: "300px" }}
                />
                <select
                    className="input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | "has_external" | "has_internal" | "empty")}
                >
                    <option value="all">Все</option>
                    <option value="has_external">Есть external</option>
                    <option value="has_internal">Есть internal</option>
                    <option value="empty">Пустые</option>
                </select>
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button className="btn btn-primary" onClick={loadSessions} disabled={loading}>
                    {loading ? "Обновление..." : "Обновить список"}
                </button>
                <button className="btn btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
                    Экспорт CSV
                </button>
            </div>
            {loading ? (
                <p style={{ color: "#666" }}>Загрузка сессий...</p>
            ) : filtered.length === 0 ? (
                <p style={{ color: "#666" }}>Сессии пока не найдены</p>
            ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                    {pageItems.map((s) => (
                        <div
                            key={s.session_id}
                            style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", background: "#fff" }}
                        >
                            <div
                                style={{ cursor: "pointer", fontWeight: 600, color: "#334155" }}
                                onClick={() => {
                                    toggleSession(s.session_id);
                                }}
                            >
                                {openedSessionIds.has(s.session_id) ? "▼" : "▶"}{" "}
                                Session #{s.session_id} | result: {s.result_id} | ext: {s.external_count}, int: {s.internal_count}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                                created: {fmtTs(s.created_at)} | merkle: {shortKey(s.merkle_root || "n/a")}
                            </div>
                            {openedSessionIds.has(s.session_id) && expandedSessions[s.session_id] && renderSessionDetails(expandedSessions[s.session_id])}
                        </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                        <span style={{ color: "#666" }}>Найдено: {filtered.length}</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <button className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Назад</button>
                            <span>Стр. {pageSafe} / {totalPages}</span>
                            <button className="btn btn-secondary" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Вперед</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
