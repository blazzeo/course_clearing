import { useMemo, useState } from "react";
import { sha256 } from "js-sha256";
import { ClearingAuditResult } from "../interfaces";

type GraphEdge = {
    id: string;
    from: string;
    to: string;
    amount: number;
    color: string;
    kind: "input" | "external" | "internal";
    obligation?: string;
};

type Point = { x: number; y: number };
type NodeImpact = {
    inputIncoming: number;
    inputOutgoing: number;
    settlementIncoming: number;
    settlementOutgoing: number;
};

const shortKey = (value: string) => `${value.slice(0, 6)}...${value.slice(-6)}`;
const fmtSol = (lamports: number) => `${(lamports / 1e9).toFixed(4)} SOL`;

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
        throw new Error(`Invalid hex32: ${hex}`);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function hashPairHex(left: string, right: string): string {
    const l = hexToBytes(left);
    const r = hexToBytes(right);
    const hasher = sha256.create();
    hasher.update(Array.from(l));
    hasher.update(Array.from(r));
    return hasher.hex();
}

function buildMerkleLevels(leaves: string[]): string[][] {
    if (!leaves.length) return [];
    const levels: string[][] = [leaves.map((h) => h.toLowerCase())];
    while (levels[levels.length - 1].length > 1) {
        const prev = levels[levels.length - 1];
        const next: string[] = [];
        for (let i = 0; i < prev.length; i += 2) {
            const left = prev[i];
            const right = i + 1 < prev.length ? prev[i + 1] : prev[i];
            next.push(hashPairHex(left, right));
        }
        levels.push(next);
    }
    return levels;
}

function edgeControlPoint(from: Point, to: Point, bend: number): Point {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;
    return { x: (from.x + to.x) / 2 + nx * bend, y: (from.y + to.y) / 2 + ny * bend };
}

function quadraticPoint(from: Point, ctrl: Point, to: Point, t: number): Point {
    const oneMinus = 1 - t;
    return {
        x: oneMinus * oneMinus * from.x + 2 * oneMinus * t * ctrl.x + t * t * to.x,
        y: oneMinus * oneMinus * from.y + 2 * oneMinus * t * ctrl.y + t * t * to.y,
    };
}

function quadraticTangent(from: Point, ctrl: Point, to: Point, t: number): Point {
    return {
        x: 2 * (1 - t) * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x),
        y: 2 * (1 - t) * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y),
    };
}

function edgeArrowPoints(tip: Point, tangent: Point): string {
    const len = Math.max(1, Math.hypot(tangent.x, tangent.y));
    const ux = tangent.x / len;
    const uy = tangent.y / len;
    const tipX = tip.x;
    const tipY = tip.y;
    const baseX = tipX - ux * 10;
    const baseY = tipY - uy * 10;
    const nx = -uy;
    const ny = ux;
    const w = 5;
    return `${tipX},${tipY} ${baseX + nx * w},${baseY + ny * w} ${baseX - nx * w},${baseY - ny * w}`;
}

export default function SessionVisualization({ audit }: { audit: ClearingAuditResult }) {
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [graphLevel, setGraphLevel] = useState<"input" | "netting">("input");
    const [selectedLeafIdx, setSelectedLeafIdx] = useState<number | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastPointer, setLastPointer] = useState<Point | null>(null);

    const {
        inputNodes,
        nettingNodes,
        inputEdges,
        nettingEdges,
        inputPositions,
        nettingPositions,
        inputBends,
        nettingBends,
        nodeImpact,
    } = useMemo(() => {
        const allEdges: GraphEdge[] = [];
        const obligationToPair = new Map<string, { from: string; to: string }>();

        for (const ob of audit.input_obligations || []) {
            obligationToPair.set(ob.obligation, { from: ob.from, to: ob.to });
            allEdges.push({
                id: `in-${ob.obligation}`,
                from: ob.from,
                to: ob.to,
                amount: Number(ob.amount),
                color: "#64748b",
                kind: "input",
                obligation: ob.obligation,
            });
        }
        for (const ext of audit.data || []) {
            allEdges.push({
                id: `ex-${ext.from}-${ext.to}-${ext.amount}`,
                from: ext.from,
                to: ext.to,
                amount: Number(ext.amount),
                color: "#2563eb",
                kind: "external",
            });
        }
        for (const intr of audit.internal_data || []) {
            const used = Number(intr.flow_used || 0);
            if (used <= 0) continue;
            const pair = obligationToPair.get(intr.obligation);
            if (!pair) continue;
            allEdges.push({
                id: `int-${intr.obligation}`,
                from: pair.from,
                to: pair.to,
                amount: used,
                color: "#d97706",
                kind: "internal",
                obligation: intr.obligation,
            });
        }

        const inputEdges = allEdges.filter((e) => e.kind === "input");
        const nettingEdges = allEdges.filter((e) => e.kind !== "input");
        const inputNodes = Array.from(new Set(inputEdges.flatMap((e) => [e.from, e.to]))).sort();
        const nettingNodes = Array.from(new Set(nettingEdges.flatMap((e) => [e.from, e.to]))).sort();

        const layoutNodes = (nodes: string[]): Map<string, Point> => {
            const cx = 430;
            const cy = 220;
            const radius = Math.max(130, Math.min(190, 55 + nodes.length * 18));
            const positions = new Map<string, Point>();
            nodes.forEach((node, idx) => {
                const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
                positions.set(node, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
            });
            return positions;
        };
        const inputPositions = layoutNodes(inputNodes);
        const nettingPositions = layoutNodes(nettingNodes);

        const nodeImpact = new Map<string, NodeImpact>();
        Array.from(new Set([...inputNodes, ...nettingNodes])).forEach((n) =>
            nodeImpact.set(n, {
                inputIncoming: 0,
                inputOutgoing: 0,
                settlementIncoming: 0,
                settlementOutgoing: 0,
            })
        );
        for (const e of allEdges) {
            const out = nodeImpact.get(e.from);
            const inn = nodeImpact.get(e.to);
            if (e.kind === "input") {
                if (out) out.inputOutgoing += e.amount;
                if (inn) inn.inputIncoming += e.amount;
            } else {
                if (out) out.settlementOutgoing += e.amount;
                if (inn) inn.settlementIncoming += e.amount;
            }
        }

        const computeBends = (edges: GraphEdge[]) => {
            const grouped = new Map<string, GraphEdge[]>();
            for (const e of edges) {
                const a = e.from < e.to ? e.from : e.to;
                const b = e.from < e.to ? e.to : e.from;
                const key = `${a}|${b}`;
                const bucket = grouped.get(key) || [];
                bucket.push(e);
                grouped.set(key, bucket);
            }
            const bends = new Map<string, number>();
            for (const [, bucket] of grouped) {
                const a = bucket[0].from < bucket[0].to ? bucket[0].from : bucket[0].to;
                const forward = bucket.filter((e) => e.from === a);
                const backward = bucket.filter((e) => e.from !== a);
                const bothDirs = forward.length > 0 && backward.length > 0;
                const spread = (arr: GraphEdge[], dir: number) => {
                    arr.forEach((edge, idx) => {
                        const centered = idx - (arr.length - 1) / 2;
                        const base = bothDirs ? dir * 42 : 0;
                        bends.set(edge.id, base + centered * 26);
                    });
                };
                spread(forward, 1);
                spread(backward, -1);
            }
            return bends;
        };

        return {
            inputNodes,
            nettingNodes,
            inputEdges,
            nettingEdges,
            inputPositions,
            nettingPositions,
            inputBends: computeBends(inputEdges),
            nettingBends: computeBends(nettingEdges),
            nodeImpact,
        };
    }, [audit]);

    const levels = useMemo(() => buildMerkleLevels((audit.merkle_leaves || []).map((x) => x.leaf_hash)), [audit.merkle_leaves]);
    const selectedLeaf = selectedLeafIdx != null ? (audit.merkle_leaves || [])[selectedLeafIdx] : null;
    const merkleRootComputed = levels.length ? levels[levels.length - 1][0] : "";
    const merkleRootMatches =
        merkleRootComputed &&
        audit.merkle_root &&
        merkleRootComputed.toLowerCase() === audit.merkle_root.toLowerCase();

    const activeEdges = graphLevel === "input" ? inputEdges : nettingEdges;
    const activeNodes = graphLevel === "input" ? inputNodes : nettingNodes;
    const activePositions = graphLevel === "input" ? inputPositions : nettingPositions;
    const activeBends = graphLevel === "input" ? inputBends : nettingBends;
    const highlightedEdges = hoveredNode
        ? activeEdges.filter((e) => e.from === hoveredNode || e.to === hoveredNode).map((e) => e.id)
        : [];
    const impact = hoveredNode ? nodeImpact.get(hoveredNode) : null;
    const pathIndices = selectedLeafIdx == null ? [] : levels.map((_, level) => Math.floor(selectedLeafIdx / 2 ** level));

    const clampZoom = (value: number) => Math.max(0.45, Math.min(2.8, value));

    return (
        <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ fontSize: "12px", color: "#475569" }}>
                Наведи на ноду, чтобы подсветить связанные ребра и увидеть вклад в баланс.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "12px" }}>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px", background: "#f8fafc" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                        <button
                            type="button"
                            className={graphLevel === "input" ? "btn btn-primary" : "btn btn-secondary"}
                            onClick={() => {
                                setGraphLevel("input");
                                setHoveredNode(null);
                            }}
                        >
                            L1 Входные данные
                        </button>
                        <button
                            type="button"
                            className={graphLevel === "netting" ? "btn btn-primary" : "btn btn-secondary"}
                            onClick={() => {
                                setGraphLevel("netting");
                                setHoveredNode(null);
                            }}
                        >
                            L2 Неттинг
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setZoom((z) => clampZoom(z * 1.15))}>+</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setZoom((z) => clampZoom(z / 1.15))}>-</button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                                setZoom(1);
                                setPan({ x: 0, y: 0 });
                            }}
                        >
                            Reset
                        </button>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>Масштаб: {(zoom * 100).toFixed(0)}%</span>
                    </div>
                    {!activeNodes.length ? (
                        <div style={{ color: "#64748b" }}>Нет ребер для визуализации.</div>
                    ) : (
                        <svg
                            viewBox="0 0 860 440"
                            style={{ width: "100%", height: "440px", background: "#fff", borderRadius: "6px", touchAction: "none", cursor: isPanning ? "grabbing" : "grab" }}
                            onWheel={(e) => {
                                const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
                                setZoom((z) => clampZoom(z * factor));
                            }}
                            onMouseDown={(e) => {
                                setIsPanning(true);
                                setLastPointer({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => {
                                if (!isPanning || !lastPointer) return;
                                const dx = e.clientX - lastPointer.x;
                                const dy = e.clientY - lastPointer.y;
                                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
                                setLastPointer({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseUp={() => {
                                setIsPanning(false);
                                setLastPointer(null);
                            }}
                            onMouseLeave={() => {
                                setIsPanning(false);
                                setLastPointer(null);
                            }}
                        >
                            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                                {activeEdges.map((edge) => {
                                    const from = activePositions.get(edge.from);
                                    const to = activePositions.get(edge.to);
                                    if (!from || !to) return null;
                                    const active = !hoveredNode || highlightedEdges.includes(edge.id);
                                    const opacity = active ? 0.95 : 0.15;
                                    const bend = activeBends.get(edge.id) || 0;
                                    // Для встречных A->B и B->A используем одну "сторону" изгиба
                                    // относительно канонического порядка пары, чтобы траектории не совпадали.
                                    const signedBend = edge.from < edge.to ? bend : -bend;
                                    const dx = to.x - from.x;
                                    const dy = to.y - from.y;
                                    const len = Math.max(1, Math.hypot(dx, dy));
                                    const nx = -dy / len;
                                    const ny = dx / len;
                                    // Разводим не только центр дуги, но и точки входа/выхода у нод.
                                    const endpointShift = Math.max(-18, Math.min(18, signedBend * 0.45));
                                    const fromShifted = { x: from.x + nx * endpointShift, y: from.y + ny * endpointShift };
                                    const toShifted = { x: to.x + nx * endpointShift, y: to.y + ny * endpointShift };
                                    const ctrl = edgeControlPoint(fromShifted, toShifted, signedBend * 1.15);
                                    const mid = quadraticPoint(fromShifted, ctrl, toShifted, 0.5);
                                    const tip = quadraticPoint(fromShifted, ctrl, toShifted, 0.9);
                                    const tangent = quadraticTangent(fromShifted, ctrl, toShifted, 0.9);
                                    return (
                                        <g key={edge.id} opacity={opacity}>
                                            <path
                                                d={`M ${fromShifted.x} ${fromShifted.y} Q ${ctrl.x} ${ctrl.y} ${toShifted.x} ${toShifted.y}`}
                                                stroke={edge.color}
                                                strokeWidth={active ? 2.8 : 1.2}
                                                strokeDasharray={edge.kind === "internal" ? "6 4" : "none"}
                                                fill="none"
                                            />
                                            <polygon points={edgeArrowPoints(tip, tangent)} fill={edge.color} />
                                            <text x={mid.x} y={mid.y - 6} fill="#0f172a" fontSize="11" textAnchor="middle">
                                                {fmtSol(edge.amount)}
                                            </text>
                                        </g>
                                    );
                                })}
                                {activeNodes.map((node) => {
                                    const p = activePositions.get(node);
                                    if (!p) return null;
                                    const active = !hoveredNode || node === hoveredNode;
                                    const im = nodeImpact.get(node);
                                    const inputNet = (im?.inputIncoming || 0) - (im?.inputOutgoing || 0);
                                    return (
                                        <g
                                            key={node}
                                            onMouseEnter={() => setHoveredNode(node)}
                                            onMouseLeave={() => setHoveredNode(null)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <circle
                                                cx={p.x}
                                                cy={p.y}
                                                r={26}
                                                fill={active ? "#e2e8f0" : "#f8fafc"}
                                                stroke={active ? "#334155" : "#94a3b8"}
                                                strokeWidth={active ? 2.5 : 1.5}
                                            />
                                            <text x={p.x} y={p.y - 3} textAnchor="middle" fontSize="10" fill="#0f172a">
                                                {shortKey(node)}
                                            </text>
                                            <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize="9" fill={inputNet >= 0 ? "#166534" : "#b91c1c"}>
                                                {inputNet >= 0 ? "+" : ""}{(inputNet / 1e9).toFixed(2)}
                                            </text>
                                        </g>
                                    );
                                })}
                            </g>
                        </svg>
                    )}
                </div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", background: "#fff" }}>
                    <div style={{ fontWeight: 600, marginBottom: "8px" }}>Детали контрагента</div>
                    {!hoveredNode || !impact ? (
                        <div style={{ color: "#64748b", fontSize: "13px" }}>Наведи на ноду в графе.</div>
                    ) : (
                        <div style={{ display: "grid", gap: "6px", fontSize: "13px" }}>
                            <div><b>Кошелек:</b> {hoveredNode}</div>
                            <div><b>Input incoming:</b> {fmtSol(impact.inputIncoming)}</div>
                            <div><b>Input outgoing:</b> {fmtSol(impact.inputOutgoing)}</div>
                            <div><b>Input net:</b> <span style={{ color: impact.inputIncoming - impact.inputOutgoing >= 0 ? "#166534" : "#b91c1c" }}>{fmtSol(impact.inputIncoming - impact.inputOutgoing)}</span></div>
                            <div style={{ marginTop: "6px" }}><b>Settlement incoming:</b> {fmtSol(impact.settlementIncoming)}</div>
                            <div><b>Settlement outgoing:</b> {fmtSol(impact.settlementOutgoing)}</div>
                            <div><b>Settlement net:</b> <span style={{ color: impact.settlementIncoming - impact.settlementOutgoing >= 0 ? "#166534" : "#b91c1c" }}>{fmtSol(impact.settlementIncoming - impact.settlementOutgoing)}</span></div>
                        </div>
                    )}
                    <div style={{ marginTop: "12px", fontSize: "12px", color: "#334155" }}>
                        <div><span style={{ color: "#64748b" }}>Легенда:</span></div>
                        <div>— L1: только исходные обязательства</div>
                        <div>— L2: только ребра неттинга (external/internal)</div>
                        <div>— синий: external, оранжевый пунктир: internal</div>
                    </div>
                </div>
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px", background: "#fff" }}>
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>Merkle tree</div>
                {!audit.merkle_leaves?.length ? (
                    <div style={{ color: "#64748b" }}>Листьев нет: для этой сессии не было применяемых операций.</div>
                ) : (
                    <div style={{ display: "grid", gap: "8px" }}>
                        <div style={{ fontSize: "12px", color: "#475569" }}>
                            Корень из payload: <code>{audit.merkle_root}</code><br />
                            Вычисленный из листьев: <code>{merkleRootComputed || "-"}</code>{" "}
                            <b style={{ color: merkleRootMatches ? "#166534" : "#b91c1c" }}>
                                {merkleRootMatches ? "совпадает" : "не совпадает"}
                            </b>
                        </div>
                        {levels.map((level, levelIdx) => (
                            <div key={`lvl-${levelIdx}`} style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                                <b style={{ minWidth: "70px" }}>L{levelIdx}</b>
                                {level.map((hash, idx) => {
                                    const selected = pathIndices[levelIdx] === idx;
                                    return (
                                        <button
                                            key={`${levelIdx}-${idx}-${hash}`}
                                            type="button"
                                            onClick={() => {
                                                if (levelIdx === 0) setSelectedLeafIdx(idx);
                                            }}
                                            style={{
                                                border: selected ? "2px solid #2563eb" : "1px solid #cbd5e1",
                                                borderRadius: "6px",
                                                background: selected ? "#eff6ff" : "#f8fafc",
                                                fontFamily: "monospace",
                                                fontSize: "11px",
                                                padding: "3px 6px",
                                                cursor: levelIdx === 0 ? "pointer" : "default",
                                            }}
                                            title={hash}
                                        >
                                            {hash.slice(0, 10)}...{hash.slice(-8)}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                            Нажми leaf на уровне L0, чтобы увидеть proof путь.
                        </div>
                        {selectedLeaf && (
                            <div style={{ borderTop: "1px dashed #cbd5e1", paddingTop: "8px", fontSize: "12px" }}>
                                <div><b>Leaf #{selectedLeaf.index}</b> [{selectedLeaf.kind}] {selectedLeaf.obligation} / {fmtSol(selectedLeaf.amount)}</div>
                                <div style={{ marginTop: "4px" }}><b>Proof:</b></div>
                                <ol style={{ margin: "4px 0 0 18px" }}>
                                    {selectedLeaf.proof.map((p, i) => (
                                        <li key={`${p}-${i}`} style={{ fontFamily: "monospace" }}>
                                            {p}
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
