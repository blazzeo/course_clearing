import type { ClearingAuditResult } from "../interfaces";

/** Нетто по участнику в рамках сессии клиринга: входящие минус исходящие по внешним аллокациям (external). Лампорты; положительное — получатель. */
export function computeSettlementNetLamports(audit: ClearingAuditResult): Map<string, number> {
    const net = new Map<string, number>();

    const addEdge = (from: string, to: string, amount: number) => {
        net.set(from, (net.get(from) ?? 0) - amount);
        net.set(to, (net.get(to) ?? 0) + amount);
    };

    for (const ext of audit.data || []) {
        addEdge(ext.from, ext.to, Number(ext.amount));
    }

    return net;
}

/** Участники сессии (входные обязательства) и нетто по расчёту; нетто 0, если в settlement не участвовал. */
export function sessionCounterpartiesWithNet(
    audit: ClearingAuditResult,
): Array<{ pubkey: string; net: number }> {
    const net = computeSettlementNetLamports(audit);
    const ids = new Set<string>();
    for (const o of audit.input_obligations || []) {
        ids.add(o.from);
        ids.add(o.to);
    }
    for (const k of net.keys()) ids.add(k);

    return Array.from(ids)
        .sort((a, b) => a.localeCompare(b))
        .map((pubkey) => ({ pubkey, net: net.get(pubkey) ?? 0 }));
}
