import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { useMemo } from 'react';
import axios from 'axios';
import idl from "./clearing_solana.json"
import type { ClearingSolana } from './clearing_solana';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { sha256 } from 'js-sha256';
import { Bill, ClearingAuditResult, ClearingSessionSummary, Obligation, ObligationStatus, Participant, SystemInfo, UserType } from './interfaces';

type BNLike = { toNumber: () => number };
type AnchorEnum = Record<string, unknown>;
type DbObligationApiItem = {
    pda: string;
    from_address: string;
    to_address: string;
    original_amount: number;
    remaining_amount: number;
    status: string;
    created_at: number;
    updated_at: number;
    closed_at: number | null;
};

export function getProgram(provider: AnchorProvider): Program<ClearingSolana> {
    return new Program<ClearingSolana>(
        idl as ClearingSolana,
        provider
    );
}

export function useProgram() {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    return useMemo(() => {
        if (!wallet) return null;
        const provider = new AnchorProvider(connection, wallet, {});
        return getProgram(provider);
    }, [connection, wallet]);
}

export function getParticipantPda(
    programId: PublicKey,
    participantPubkey: PublicKey
) {
    const encoder = new TextEncoder();

    const [pda] = PublicKey.findProgramAddressSync(
        [
            encoder.encode("participant"),
            participantPubkey.toBuffer(),
        ],
        programId
    );

    return pda;
}

export async function getParticipant(
    program: Program<ClearingSolana>,
    pda: PublicKey
): Promise<Participant | null> {
    const result = await program.account.participant.fetchNullable(pda);

    if (result == null)
        return null

    return {
        pda: pda,
        authority: result.authority,
        userType: parseUserType(result.userType),
        registrationTimestamp: result.registrationTimestamp.toNumber(),
        updateTimestamp: result.updateTimestamp.toNumber(),
        totalObligations: result.totalObligations,
        lastSessionId: result.lastSessionId.toNumber(),
        name: result.name,
        bump: result.bump
    };
}

export async function initEscrow(program: Program<ClearingSolana>) {
    const authority = program.provider.publicKey;

    return await program.methods
        .initEscrow()
        .accounts({
            authority,
        })
        .rpc();
}

export async function registerObligation(
    program: Program<ClearingSolana>,
    from: PublicKey,
    to: PublicKey,
    amount: number,
    pool_id: number,
    timestamp?: number
) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp ?? Math.floor(Date.now() / 1000));

    const id = new BN(pool_id)

    const amt = new BN(amount)

    return await program.methods
        .registerObligation(from, to, amt, id, ts)
        .accounts({
            authority,
        })
        .rpc();
}

export async function confirmObligation(
    program: Program<ClearingSolana>,
    obligation: Obligation // Передаем весь объект целиком!
) {
    const authority = program.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");

    // Берем данные ПРЯМО из объекта, который пришел из блокчейна
    const from = obligation.from;
    const to = obligation.to;
    // Используем BN напрямую, если он сохранился, или создаем новый
    const tsBN = new BN(obligation.timestamp);

    // Вычисляем PDA участников (они зависят только от Pubkey, тут ошибок обычно нет)
    const [fromParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), from.toBuffer()],
        program.programId
    );

    const [toParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), to.toBuffer()],
        program.programId
    );

    // ВАЖНО: obligation.publicKey должен быть объектом PublicKey
    const obligationPda = obligation.pda;

    return await program.methods
        .confirmObligation(from, to, tsBN) // Эти аргументы используются для проверки seeds!
        .accounts({
            fromParticipant,
            toParticipant,
            obligation: obligationPda,
            authority: authority,
        })
        .rpc();
}

export async function cancelObligation(program: Program<ClearingSolana>, obligation: Obligation) {
    const authority = program.provider.publicKey;

    // Берем данные ПРЯМО из объекта, который пришел из блокчейна
    const from = obligation.from;
    const to = obligation.to;
    // Используем BN напрямую, если он сохранился, или создаем новый
    const tsBN = new BN(obligation.timestamp);

    // Вычисляем PDA участников (они зависят только от Pubkey, тут ошибок обычно нет)
    const [fromParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), from.toBuffer()],
        program.programId
    );

    const [toParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), to.toBuffer()],
        program.programId
    );

    // ВАЖНО: obligation.publicKey должен быть объектом PublicKey
    const obligationPda = obligation.pda;

    return await program.methods
        .cancelObligation(from, to, tsBN)
        .accounts({
            fromParticipant,
            toParticipant,
            obligation: obligationPda,
            authority: authority,
        })
        .rpc();
}

export async function declineObligation(program: Program<ClearingSolana>, obligation: Obligation) {
    const authority = program.provider.publicKey;

    // Берем данные ПРЯМО из объекта, который пришел из блокчейна
    const from = obligation.from;
    const to = obligation.to;
    // Используем BN напрямую, если он сохранился, или создаем новый
    const tsBN = new BN(obligation.timestamp);

    // Вычисляем PDA участников (они зависят только от Pubkey, тут ошибок обычно нет)
    const [fromParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), from.toBuffer()],
        program.programId
    );

    const [toParticipant] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), to.toBuffer()],
        program.programId
    );

    // ВАЖНО: obligation.publicKey должен быть объектом PublicKey
    const obligationPda = obligation.pda;

    return await program.methods
        .declineObligation(from, to, tsBN)
        .accounts({
            fromParticipant,
            toParticipant,
            obligation: obligationPda,
            authority: authority,
        })
        .rpc();
}

export async function finalizeClearingSession(program: Program<ClearingSolana>) {
    const authority = program.provider.publicKey;
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const [session] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("session"),
            new BN(stateAccount.totalSessions.toString()).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
    );

    return await program.methods
        .finalizeClearingSession()
        .accounts({
            state,
            session,
            authority,
        })
        .rpc();
}

export async function buildFinalizeClearingSessionTx(
    program: Program<ClearingSolana>,
    sessionId?: number
): Promise<Transaction> {
    const authority = program.provider.publicKey;
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const effectiveSessionId =
        sessionId ?? new BN(stateAccount.totalSessions.toString()).toNumber();
    const [session] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("session"),
            new BN(effectiveSessionId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
    );

    return await program.methods
        .finalizeClearingSession()
        .accounts({
            state,
            session,
            authority,
        })
        .transaction();
}

export async function startClearingSession(program: Program<ClearingSolana>, totalObligations: number) {
    const authority = program.provider.publicKey;

    const total_obligations = new BN(totalObligations);

    // state
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );

    const stateAccount = await program.account.clearingState.fetch(state);

    //	session
    const [session] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('session'),
            new BN(stateAccount.totalSessions.toString()).addn(1).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
    )

    return await program.methods
        .startClearingSession(total_obligations)
        .accounts({
            session,
            authority,
        })
        .rpc();
}

export async function buildStartClearingSessionTx(
    program: Program<ClearingSolana>,
    totalObligations: number
): Promise<Transaction> {
    const authority = program.provider.publicKey;
    const total_obligations = new BN(totalObligations);
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const [session] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('session'),
            new BN(stateAccount.totalSessions.toString()).addn(1).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
    );

    return await program.methods
        .startClearingSession(total_obligations)
        .accounts({
            session,
            authority,
        })
        .transaction();
}

export async function createNewPool(program: Program<ClearingSolana>, last_pool_id: number) {
    const authority = program.provider.publicKey;
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );

    const lastPoolId = new BN(last_pool_id)
    const nextPoolId = new BN(last_pool_id + 1)

    // new pool
    const [newPool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), nextPoolId.toArrayLike(Buffer, 'le', 4)],
        program.programId
    );

    return await program.methods
        .createNewPool(lastPoolId)
        .accounts({
            state,
            newPool,
            authority,
        })
        .rpc();
}

export async function createPositionByObligation(
    program: Program<ClearingSolana>,
    obligationPda: PublicKey,
    amount: number
) {
    const payer = program.provider.publicKey;
    if (!payer) throw new Error("Wallet not connected");

    const obligation = await program.account.obligation.fetch(obligationPda);
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const [session] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), new BN(stateAccount.totalSessions.toString()).toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), new BN(obligation.poolId.toString()).toArrayLike(Buffer, "le", 4)],
        program.programId
    );
    const [fromPosition] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), session.toBuffer(), obligation.from.toBuffer(), obligation.to.toBuffer()],
        program.programId
    );

    return await (program as any).methods
        .createPosition(obligation.from, obligation.to, obligation.timestamp, new BN(amount))
        .accounts({
            state,
            session,
            obligation: obligationPda,
            pool,
            pairPosition: fromPosition,
            payer,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
}

export async function buildApplyInternalNettingTx(
    program: Program<ClearingSolana>,
    obligationPda: PublicKey,
    amount: number,
    sessionId?: number
): Promise<Transaction> {
    const authority = program.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");
    const obligation = await program.account.obligation.fetch(obligationPda);
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const effectiveSessionId =
        sessionId ?? new BN(stateAccount.totalSessions.toString()).toNumber();
    const [session] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), new BN(effectiveSessionId).toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), new BN(obligation.poolId.toString()).toArrayLike(Buffer, "le", 4)],
        program.programId
    );
    return await (program as any).methods
        .applyInternalNetting(
            obligation.from,
            obligation.to,
            obligation.timestamp,
            new BN(amount)
        )
        .accounts({
            state,
            session,
            obligation: obligationPda,
            pool,
            authority,
        })
        .transaction();
}

export async function applyInternalNetting(
    program: Program<ClearingSolana>,
    obligationPda: PublicKey,
    amount: number
) {
    const authority = program.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");
    const obligation = await program.account.obligation.fetch(obligationPda);
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const [session] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), new BN(stateAccount.totalSessions.toString()).toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), new BN(obligation.poolId.toString()).toArrayLike(Buffer, "le", 4)],
        program.programId
    );
    return await (program as any).methods
        .applyInternalNetting(
            obligation.from,
            obligation.to,
            obligation.timestamp,
            new BN(amount)
        )
        .accounts({
            state,
            session,
            obligation: obligationPda,
            pool,
            authority,
        })
        .rpc();
}

export async function buildCreatePositionByObligationTx(
    program: Program<ClearingSolana>,
    obligationPda: PublicKey,
    amount: number,
    sessionId?: number
): Promise<Transaction> {
    const payer = program.provider.publicKey;
    if (!payer) throw new Error("Wallet not connected");

    const obligation = await program.account.obligation.fetch(obligationPda);
    const [state] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const stateAccount = await program.account.clearingState.fetch(state);
    const effectiveSessionId =
        sessionId ?? new BN(stateAccount.totalSessions.toString()).toNumber();
    const [session] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), new BN(effectiveSessionId).toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), new BN(obligation.poolId.toString()).toArrayLike(Buffer, "le", 4)],
        program.programId
    );
    const [fromPosition] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), session.toBuffer(), obligation.from.toBuffer(), obligation.to.toBuffer()],
        program.programId
    );

    return await (program as any).methods
        .createPosition(obligation.from, obligation.to, obligation.timestamp, new BN(amount))
        .accounts({
            state,
            session,
            obligation: obligationPda,
            pool,
            pairPosition: fromPosition,
            payer,
            systemProgram: SystemProgram.programId,
        })
        .transaction();
}

export async function registerParticipant(program: Program<ClearingSolana>, name: string) {
    const authority = program.provider.publicKey!;

    const encoder = new TextEncoder();

    name = name.trim().toLowerCase()

    // ✅ SHA256 → Uint8Array (32 bytes)
    // const nameBytes = new Uint8Array(name)
    const hashBytes = new Uint8Array(sha256.array(name));

    // ✅ Anchor ожидает number[]
    const nameHash = Array.from(hashBytes);

    // state PDA
    const [state] = PublicKey.findProgramAddressSync(
        [encoder.encode("state")],
        program.programId
    );

    // participant PDA
    const [newParticipant] = PublicKey.findProgramAddressSync(
        [encoder.encode("participant"), authority.toBuffer()],
        program.programId
    );

    // nameRegistry PDA (ВАЖНО: 32 bytes)
    const [nameRegistry] = PublicKey.findProgramAddressSync(
        [encoder.encode("name_registry"), Uint8Array.from(nameHash)],
        program.programId
    );

    return await program.methods
        .registerParticipant(nameHash, name)
        .accounts({
            state,
            newParticipant,
            nameRegistry,
            authority,
            systemProgram: SystemProgram.programId
        })
        .rpc();
}

export async function settle_position(
    program: Program<ClearingSolana>,
    session_id: number,
    to: PublicKey,
    amount: number
) {
    const authority = program.provider.publicKey;

    const sid = new BN(session_id);

    const amt = new BN(amount);

    // recipient
    const recipient = to;

    return await (program as any).methods
        .settlePosition(sid, to, amt)
        .accounts({
            authority,
            recipient,
        })
        .rpc();
}

export async function withdrawFee(program: Program<ClearingSolana>, amount: number) {
    const authority = program.provider.publicKey;

    const amt = new BN(amount)

    return await program.methods
        .withdrawFee(amt)
        .accounts({
            authority,
        })
        .rpc();
}

export async function updateUserType(
    program: Program<ClearingSolana>,
    participant: PublicKey,
    userType: AnchorEnum
) {
    const authority = program.provider.publicKey;

    return await program.methods
        .updateUserType(participant, userType)
        .accounts({
            authority,
        })
        .rpc();
}

export async function payFee(program: Program<ClearingSolana>, session_id: number, creditor: PublicKey) {
    const authority = program.provider.publicKey;
    if (!authority) throw new Error("Wallet not connected");

    const sid = new BN(session_id)
    const participant = getParticipantPda(program.programId, authority);
    const [session] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), sid.toArrayLike(Buffer, "le", 8)],
        program.programId
    );
    const [netPosition] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), session.toBuffer(), authority.toBuffer(), creditor.toBuffer()],
        program.programId
    );

    return await (program as any).methods
        .payFee(sid, creditor)
        .accounts({
            participant,
            session,
            netPosition,
            authority,
        })
        .rpc();
}

export async function updateFeeRate(program: Program<ClearingSolana>, new_rate_bps: number) {
    const authority = program.provider.publicKey;

    const nrbps = new BN(new_rate_bps)


    return await program.methods
        .updateFeeRate(nrbps)
        .accounts({
            authority,
        })
        .rpc();
}

export async function updateSessionInterval(program: Program<ClearingSolana>, new_interval: number) {
    const authority = program.provider.publicKey;

    const newInterval = new BN(new_interval)

    return await program.methods
        .updateSessionIntervalTime(newInterval)
        .accounts({
            authority,
        })
        .rpc();
}

export async function getClearingState(program: Program<ClearingSolana>): Promise<SystemInfo> {
    const encoder = new TextEncoder()

    const [statePda] = PublicKey.findProgramAddressSync(
        [encoder.encode("state")],
        program.programId
    )

    const account = await program.account.clearingState.fetch(statePda)

    const info: SystemInfo = {
        total_obligations: account.totalObligations.toNumber(),
        total_participants: account.totalParticipants.toNumber(),
        total_sessions: account.totalSessions.toNumber(),
        fee_rate_bps: account.feeRateBps.toNumber(),
        session_interval_time: account.sessionIntervalTime.toNumber(),
        last_session_timestamp: account.lastSessionTimestamp.toNumber(),
    }

    return info
}

export async function getUserRole(
    program: Program<ClearingSolana>,
    publicKey: PublicKey
): Promise<UserType> {
    try {
        const participantPda = getParticipantPda(program.programId, publicKey)

        const participant = await program.account.participant.fetch(participantPda)

        return parseUserType(participant.userType)
    } catch (e) {
        console.error(e)
        return UserType.Guest
    }
}

export async function getBalance(
    connection: Connection,
    pubkey: PublicKey
): Promise<number> {
    // Баланс берем как SOL на адресе (lamports -> SOL).
    return await connection.getBalance(pubkey)
}

export function getPoolPda(
    program: Program<ClearingSolana>,
    poolId: number
): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("pool"),
            new BN(poolId).toArrayLike(Buffer, "le", 4),
        ],
        program.programId
    )[0]
}

export async function poolExists(connection: Connection, pda: PublicKey) {
    const acc = await connection.getAccountInfo(pda)
    return acc !== null
}

export async function getPool(
    program: Program<ClearingSolana>,
    pda: PublicKey
) {
    return await program.account.obligationPool.fetchNullable(pda);
}

export async function getAllObligations(
    program: Program<ClearingSolana>,
): Promise<Obligation[]> {
    const accounts = await program.account.obligation.all()

    const obligations: Obligation[] = accounts.map(({ account, publicKey }) => ({
        pda: publicKey,
        status: parseObligationStatus(account.status as AnchorEnum),
        from: account.from,
        to: account.to,
        amount: safeBN(account.amount),
        timestamp: safeBN(account.timestamp),
        sessionId: safeOptionalU64(account.sessionId),
        fromCancel: account.fromCancel,
        toCancel: account.toCancel,
        poolId: safeBN(account.poolId),
        bump: account.bump
    }));

    return obligations
}

export async function getAllParticipants(
    program: Program<ClearingSolana>,
): Promise<Participant[]> {
    const accounts = await program.account.participant.all();

    return accounts.map(({ account, publicKey }) => ({
        pda: publicKey,
        authority: account.authority,
        userType: parseUserType(account.userType),
        registrationTimestamp: safeBN(account.registrationTimestamp),
        updateTimestamp: safeBN(account.updateTimestamp),
        totalObligations: account.totalObligations,
        lastSessionId: safeBN(account.lastSessionId),
        name: account.name,
        bump: account.bump,
    }));
}

function parseUserType(userType: AnchorEnum): UserType {
    if (userType?.admin !== undefined) return UserType.Administator;
    if (userType?.participant !== undefined) return UserType.Counterparty;
    return UserType.Guest;
}

function safeBN(value: BNLike | null | undefined): number {
    if (!value) return 0;

    const num = value.toNumber();

    if (num > Number.MAX_SAFE_INTEGER) {
        throw new Error("BN overflow: value too large");
    }

    return num;
}

function safeOptionalU64(value: unknown): number {
    if (!value) return 0;
    if (typeof value === "object" && value !== null && "toNumber" in value) {
        return safeBN(value as BNLike);
    }
    if (typeof value === "object" && value !== null && "some" in value) {
        const wrapped = (value as { some?: BNLike }).some;
        return wrapped ? safeBN(wrapped) : 0;
    }
    return 0;
}

function parseObligationStatus(status: AnchorEnum): ObligationStatus {
    if (status?.created !== undefined) return ObligationStatus.Created;
    if (status?.confirmed !== undefined) return ObligationStatus.Confirmed;
    if (status?.partiallyNetted !== undefined) return ObligationStatus.PartiallyNetted;
    if (status?.declined !== undefined) return ObligationStatus.Declined;
    if (status?.netted !== undefined) return ObligationStatus.Netted;
    if (status?.cancelled !== undefined) return ObligationStatus.Cancelled;
    return ObligationStatus.Created;
}

function parseDbObligationStatus(status: string): ObligationStatus {
    switch (status.toLowerCase()) {
        case "created":
            return ObligationStatus.Created;
        case "confirmed":
            return ObligationStatus.Confirmed;
        case "partially_netted":
        case "partiallynetted":
            return ObligationStatus.PartiallyNetted;
        case "netted":
            return ObligationStatus.Netted;
        case "declined":
            return ObligationStatus.Declined;
        case "cancelled":
            return ObligationStatus.Cancelled;
        default:
            return ObligationStatus.Created;
    }
}

function parseNetPositionStatus(status: AnchorEnum): Bill["status"] {
    if (status?.none !== undefined) return 0;
    if (status?.feePaid !== undefined) return 1;
    if (status?.done !== undefined) return 2;
    return 0;
}

export async function getObligationsByParticipantFromPools(
    program: Program<ClearingSolana>,
    participantKey: PublicKey
): Promise<Obligation[]> {
    // 1. Сначала получаем список ВСЕХ ID облигаций из всех пулов
    const allIds = await getAllObligationsFromPools(program);
    if (allIds.length === 0) return [];

    // 2. Загружаем данные всех облигаций пачками (ограничение RPC обычно 100 за раз)
    const CHUNK_SIZE = 100;
    let result: Obligation[] = [];

    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);
        const obligationsData = await program.account.obligation.fetchMultiple(chunk);

        // 3. Фильтруем данные: оставляем только те, где участник — отправитель или получатель
        obligationsData.forEach((acc, index: number) => {
            if (!acc) return

            if (acc.from.equals(participantKey) || acc.to.equals(participantKey)) {
                const obligation: Obligation = {
                    pda: chunk[index],
                    status: parseObligationStatus(acc.status as AnchorEnum),
                    from: acc.from,
                    to: acc.to,
                    amount: safeBN(acc.amount),
                    timestamp: safeBN(acc.timestamp),
                    sessionId: safeOptionalU64(acc.sessionId),
                    fromCancel: acc.fromCancel,
                    toCancel: acc.toCancel,
                    poolId: safeBN(acc.poolId),
                    bump: acc.bump,
                };

                result.push(obligation)
            }
        });
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getObligationsByParticipantFromDb(
    apiUrl: string,
    participantKey: PublicKey
): Promise<Obligation[]> {
    const wallet = participantKey.toBase58();
    const res = await axios.get<{ success: boolean; data?: DbObligationApiItem[]; error?: string }>(
        `${apiUrl}/obligations/${wallet}`
    );
    if (!res.data.success || !res.data.data) {
        throw new Error(res.data.error || "Failed to load obligations from DB");
    }

    return res.data.data.map((row) => ({
        pda: new PublicKey(row.pda),
        status: parseDbObligationStatus(row.status),
        from: new PublicKey(row.from_address),
        to: new PublicKey(row.to_address),
        amount: row.remaining_amount,
        timestamp: row.created_at,
        sessionId: 0,
        fromCancel: false,
        toCancel: false,
        poolId: 0,
        bump: 0,
    }));
}

export async function getLastClearingAudit(
    apiUrl: string,
    wallet?: PublicKey
): Promise<ClearingAuditResult> {
    const endpoint = wallet
        ? `${apiUrl}/clearing/audit/last/${wallet.toBase58()}`
        : `${apiUrl}/clearing/audit/last`;
    const res = await axios.get<{ success: boolean; data?: ClearingAuditResult; error?: string }>(
        endpoint
    );
    if (!res.data.success || !res.data.data) {
        throw new Error(res.data.error || "Failed to load clearing audit");
    }
    return res.data.data;
}

export async function listClearingSessions(apiUrl: string): Promise<ClearingSessionSummary[]> {
    const res = await axios.get<{ success: boolean; data?: ClearingSessionSummary[]; error?: string }>(
        `${apiUrl}/clearing/sessions`
    );
    if (!res.data.success || !res.data.data) {
        throw new Error(res.data.error || "Failed to load sessions");
    }
    return res.data.data;
}

export async function getClearingSessionPayload(
    apiUrl: string,
    sessionId: number
): Promise<ClearingAuditResult> {
    const res = await axios.get<{ success: boolean; data?: ClearingAuditResult; error?: string }>(
        `${apiUrl}/clearing/sessions/${sessionId}`
    );
    if (!res.data.success || !res.data.data) {
        throw new Error(res.data.error || "Failed to load session payload");
    }
    return res.data.data;
}

export async function getAllObligationsFromPools(
    program: Program<ClearingSolana>
): Promise<PublicKey[]> {
    const allPubkeys: PublicKey[] = [];
    let currentIndex = 0;
    let finished = false;

    const DEFAULT_PUBKEY = new PublicKey('11111111111111111111111111111111');

    while (!finished) {
        // Формируем пачку из 10 адресов для проверки
        const pdaBatch = Array.from({ length: 10 }, (_, i) => {
            const indexBuf = Buffer.alloc(4);
            indexBuf.writeUInt32LE(currentIndex + i);
            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("pool"), indexBuf],
                program.programId
            );
            return pda
        });

        // Запрашиваем данные сразу 10 пулов
        const pools = await program.account.obligationPool.fetchMultiple(pdaBatch);

        for (const pool of pools) {
            if (pool) {
                // Берем только реально занятые слоты
                const activeInPool = pool.obligations.filter(
                    (pubkey: PublicKey) => !pubkey.equals(DEFAULT_PUBKEY)
                );

                allPubkeys.push(...activeInPool);
                currentIndex++;
            } else {
                finished = true; // Нашли пустой слот — пулов больше нет
                break;
            }
        }
    }

    return allPubkeys;
}

export async function getObligationsByParticipant(
    program: Program<ClearingSolana>,
    pubkey: PublicKey
): Promise<Obligation[]> {
    const pubkeyBase58 = pubkey.toBase58()

    const [fromPositions, toPositions] = await Promise.all([
        program.account.obligation.all([
            {
                memcmp: {
                    offset: 9,
                    bytes: pubkeyBase58,
                },
            },
        ]),
        program.account.obligation.all([
            {
                memcmp: {
                    offset: 41,
                    bytes: pubkeyBase58,
                },
            },
        ]),
    ])

    const map = new Map<string, Obligation>()

        ;[...fromPositions, ...toPositions].forEach((p) => {
            const acc = p.account

            const ot = acc.status

            const obligation: Obligation = {
                pda: p.publicKey,
                status: parseObligationStatus(ot as AnchorEnum),
                from: acc.from,
                to: acc.to,
                amount: safeBN(acc.amount),
                timestamp: safeBN(acc.timestamp),
                sessionId: safeOptionalU64(acc.sessionId),
                fromCancel: acc.fromCancel,
                toCancel: acc.toCancel,
                poolId: safeBN(acc.poolId),
                bump: acc.bump,
            }

            map.set(p.publicKey.toBase58(), obligation)
        })

    const obligaions = Array.from(map.values())

    return obligaions
}

export async function getAllBills(
    program: Program<ClearingSolana>,
): Promise<Bill[]> {
    const accounts = await program.account.netPosition.all();

    const bills: Bill[] = accounts.map(({ account, publicKey }) => ({
        pda: publicKey,
        status: parseNetPositionStatus(account.status as AnchorEnum),
        session_id: safeBN(account.sessionId),
        creditor: account.creditor,
        debitor: account.debitor,
        net_amount: safeBN(account.netAmount),
        fee_amount: safeBN(account.feeAmount),
    }));

    return bills
}

export async function getBillsByParticipant(
    program: Program<ClearingSolana>,
    pubkey: PublicKey
): Promise<Bill[]> {
    const all = await program.account.netPosition.all();
    return all
        .map(({ account, publicKey }) => ({
            pda: publicKey,
            status: parseNetPositionStatus(account.status as AnchorEnum),
            session_id: safeBN(account.sessionId),
            creditor: account.creditor,
            debitor: account.debitor,
            net_amount: safeBN(account.netAmount),
            fee_amount: safeBN(account.feeAmount),
        }))
        .filter((b) => b.debitor.equals(pubkey) && b.net_amount > 0)
        .sort((a, b) => b.session_id - a.session_id);
}
