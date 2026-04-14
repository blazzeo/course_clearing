import { PublicKey } from "@solana/web3.js";

export enum ObligationStatus {
    All,
    Created,
    Confirmed,
    PartiallyNetted,
    Declined,
    Netted,
    Cancelled,
}

export interface Obligation {
    pda: PublicKey;
    status: ObligationStatus;
    from: PublicKey;
    to: PublicKey;
    /** Текущий остаток по цепочке/БД (лампорты). Для записей из API это `remaining_amount`. */
    amount: number;
    /** Исходный номинал при создании (только для строк из БД). */
    originalAmount?: number;
    timestamp: number;
    sessionId: number;
    fromCancel: boolean;
    toCancel: boolean;
    poolId: number;
    bump: number;
}

export enum UserType {
    Guest = 'guest',
    Administator = 'admin',
    Counterparty = 'counterparty'
}

export interface Participant {
    pda: PublicKey,
    authority: PublicKey,
    userType: UserType,
    registrationTimestamp: number,
    updateTimestamp: number,
    lastSessionId: number,
    name: string,
    totalObligations: number,
    bump: number,
}

export interface SystemInfo {
    total_participants: number
    total_sessions: number
    total_obligations: number
    fee_rate_bps: number
    session_interval_time: number
    last_session_timestamp: number
}

export enum NetPositionStatus {
    None, // start: no fee payment
    FeePaid,
    Done, // means fee paid + creditor transfered net amount
}

export interface Bill {
    pda: PublicKey,
    status: NetPositionStatus,
    session_id: number,
    creditor: PublicKey,
    debitor: PublicKey,
    net_amount: number,
    fee_amount: number,
}

export interface ClearingAuditLeaf {
    kind: string;
    obligation: string;
    amount: number;
    leaf_hash: string;
    proof: string[];
}

export interface ClearingAuditLogEntry {
    step: string;
    detail: string;
    timestamp: number;
}

export interface ClearingAuditResult {
    session_id: number;
    result_id: string;
    hash: string;
    solver_version?: string;
    build_sha?: string;
    input_obligations?: {
        obligation: string;
        from: string;
        to: string;
        amount: number;
        status: string;
        timestamp: number;
    }[];
    data: { obligation: string; amount: number }[];
    internal_data: { obligation: string; amount: number }[];
    merkle_root: string;
    merkle_leaves: ClearingAuditLeaf[];
    audit_log: ClearingAuditLogEntry[];
    timestamp: number;
}

export interface ClearingSessionSummary {
    session_id: number;
    result_id: string;
    result_hash: string;
    merkle_root: string;
    external_count: number;
    internal_count: number;
    created_at: number;
}

export function UserTypeToString(userType: UserType): string {
    switch (userType) {
        case UserType.Counterparty: return 'Контрагент';
        case UserType.Administator: return 'Администратор';
        case UserType.Guest: return 'Гость';
        default: return 'Неизвестно'
    }
}
