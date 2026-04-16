import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
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

function isWalletInSession(payload: ClearingAuditResult, wallet: string): boolean {
    const inInput = (payload.input_obligations || []).some(
        (x) => x.from === wallet || x.to === wallet
    );
    const inExternal = (payload.data || []).some(
        (x) => x.from === wallet || x.to === wallet
    );
    return inInput || inExternal;
}

function renderSessionDetails(audit: ClearingAuditResult) {
    return (
        <div style={{ marginTop: "10px", fontSize: "13px", color: "#333", display: "grid", gap: "10px" }}>
            <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "8px" }}>
                <div><b>Result hash:</b> <span style={{ fontFamily: "monospace" }}>{audit.hash}</span></div>
                <div><b>Merkle root:</b> <span style={{ fontFamily: "monospace" }}>{audit.merkle_root || "-"}</span></div>
                <div><b>Allocator mode:</b> {audit.allocator_mode || "n/a"}</div>
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
                        return <li key={`in-${x.obligation}`}>{shortKey(x.obligation)}: {text}</li>;
                    })}
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

export default function UserSessionsPage() {
    const { publicKey } = useWallet();
    const [sessions, setSessions] = useState<ClearingSessionSummary[]>([]);
    const [expandedSessions, setExpandedSessions] = useState<Record<number, ClearingAuditResult>>({});
    const [openedSessionIds, setOpenedSessionIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [matchingIds, setMatchingIds] = useState<Set<number> | null>(null);

    const wallet = publicKey?.toBase58() || "";

    const ensurePayloadLoaded = async (sessionId: number) => {
        if (expandedSessions[sessionId]) return expandedSessions[sessionId];
        const payload = await getClearingSessionPayload(API_URL, sessionId);
        setExpandedSessions((prev) => ({ ...prev, [sessionId]: payload }));
        return payload;
    };

    const load = async () => {
        if (!wallet) return;
        try {
            setLoading(true);
            const all = await listClearingSessions(API_URL);
            setSessions(all);
            const matched = new Set<number>();
            for (const s of all) {
                try {
                    const payload = await getClearingSessionPayload(API_URL, s.session_id);
                    if (isWalletInSession(payload, wallet)) {
                        matched.add(s.session_id);
                        setExpandedSessions((prev) => ({ ...prev, [s.session_id]: payload }));
                    }
                } catch {
                    // ignore broken payload
                }
            }
            setMatchingIds(matched);
        } catch (error) {
            console.error("Error loading user sessions:", error);
            toast.error("Не удалось загрузить сессии");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [wallet]);

    const filtered = useMemo(() => {
        if (!matchingIds) return [];
        return sessions.filter((s) => matchingIds.has(s.session_id));
    }, [sessions, matchingIds]);

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
        await ensurePayloadLoaded(sessionId);
        setOpenedSessionIds((prev) => new Set(prev).add(sessionId));
    };

    if (!publicKey) {
        return <h1 style={{ color: "#eee" }}>Подключите кошелёк</h1>;
    }

    return (
        <div className="card">
            <h1>Мои сессии</h1>
            <p style={{ color: "#555", marginBottom: "12px" }}>
                Сессии клиринга, где ваш кошелёк участвовал как отправитель или получатель.
            </p>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button className="btn btn-primary" onClick={load} disabled={loading}>
                    {loading ? "Обновление..." : "Обновить список"}
                </button>
            </div>
            {loading ? (
                <p style={{ color: "#666" }}>Загрузка сессий...</p>
            ) : filtered.length === 0 ? (
                <p style={{ color: "#666" }}>Сессии с вашим участием не найдены</p>
            ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                    {filtered.map((s) => (
                        <div
                            key={s.session_id}
                            style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", background: "#fff" }}
                        >
                            <div
                                style={{ cursor: "pointer", fontWeight: 600, color: "#334155" }}
                                onClick={() => toggleSession(s.session_id)}
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
                </div>
            )}
        </div>
    );
}
