import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import idl from "./clearing_solana.json"
import type { ClearingSolana } from './clearing_solana';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { sha256 } from 'js-sha256';
import { Bill, Obligation, ObligationStatus, Participant, SystemInfo, UserType } from './interfaces';

export function getProgram(provider: AnchorProvider): Program<ClearingSolana> {
    return new Program<ClearingSolana>(
        idl as ClearingSolana,
        provider
    );
}

export function useProgram() {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    if (!wallet) return null;

    const provider = new AnchorProvider(connection, wallet, {});
    return getProgram(provider);
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

export async function cancelObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number, poolId: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32LE(poolId);
    const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), indexBuf],
        program.programId
    );

    return await program.methods
        .cancelObligation(from, to, ts)
        .accounts({
            authority,
            pool: poolPda
        })
        .rpc();
}

export async function confirmObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    return await program.methods
        .confirmObligation(from, to, ts)
        .accounts({
            authority,
        })
        .rpc();
}

export async function registerObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, amount: number, pool_id: number, timestamp: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    const id = new BN(pool_id)

    const amt = new BN(amount)

    return await program.methods
        .registerObligation(from, to, amt, id, ts)
        .accounts({
            authority,
        })
        .rpc();
}

export async function declineObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number, poolId: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32LE(poolId);
    const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), indexBuf],
        program.programId
    );

    return await program.methods
        .declineObligation(from, to, ts)
        .accounts({
            authority,
            pool: poolPda
        })
        .rpc();
}

export async function processObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    return await program.methods
        .processObligation(from, to, ts)
        .accounts({
            payer: authority,
        })
        .rpc();
}

export async function finalizeClearingSession(program: Program<ClearingSolana>) {
    const authority = program.provider.publicKey;

    return await program.methods
        .finalizeClearingSession()
        .accounts({
            authority,
        })
        .rpc();
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
            new BN(stateAccount.totalSessions).toArrayLike(Buffer, 'le', 8),
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

export async function createNewPool(program: Program<ClearingSolana>, last_pool_id: number) {
    const authority = program.provider.publicKey;

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
            newPool,
            authority,
        })
        .rpc();
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

export async function settle_position(program: Program<ClearingSolana>, session_id: number, to: PublicKey, timestamp: number) {
    const authority = program.provider.publicKey;

    const sid = new BN(session_id);

    const ts = new BN(timestamp);

    // recipient
    const recipient = to;

    return await program.methods
        .settlePosition(sid, to, ts)
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

// TODO: fix userType enum
export async function updateUserType(program: Program<ClearingSolana>, participant: PublicKey, userType: any) {
    const authority = program.provider.publicKey;

    return await program.methods
        .updateUserType(participant, userType)
        .accounts({
            authority,
        })
        .rpc();
}

export async function payFee(program: Program<ClearingSolana>, session_id: number) {
    const authority = program.provider.publicKey;

    const sid = new BN(session_id)

    return await program.methods
        .payFee(sid)
        .accounts({
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
        session_interval_time: account.sessionIntervalTime.toNumber()
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
            new BN(poolId).toArrayLike(Buffer, "le", 8),
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
        publicKey: publicKey.toBase58(),
        status: account.status,
        from: account.from,
        to: account.to,
        amount: safeBN(account.amount),
        timestamp: safeBN(account.timestamp),
        sessionId: safeBN(account.sessionId),
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

function parseUserType(userType: any): UserType {
    if (userType?.admin !== undefined) return UserType.Administator;
    if (userType?.participant !== undefined) return UserType.Counterparty;
    return UserType.Guest;
}

function safeBN(value: any): number {
    if (!value) return 0;

    const num = value.toNumber();

    if (num > Number.MAX_SAFE_INTEGER) {
        throw new Error("BN overflow: value too large");
    }

    return num;
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
        obligationsData.forEach((acc: any, index: number) => {
            if (!acc) return

            if (acc.from.equals(participantKey) || acc.to.equals(participantKey)) {
                let status = ObligationStatus.Created;
                if (acc.status.created) status = ObligationStatus.Created;
                else if (acc.status.netted) status = ObligationStatus.Netted;
                else if (acc.status.declined) status = ObligationStatus.Declined;
                else if (acc.status.confirmed) status = ObligationStatus.Confirmed;
                else if (acc.status.cancelled) status = ObligationStatus.Cancelled;

                const obligation: Obligation = {
                    publicKey: chunk[index].toBase58(),
                    status: status,
                    from: acc.from,
                    to: acc.to,
                    amount: acc.amount.toNumber(),    // BN -> number
                    timestamp: acc.timestamp.toNumber(), // BN -> number
                    sessionId: acc.sessionId,
                    fromCancel: acc.fromCancel,
                    toCancel: acc.toCancel,
                    poolId: acc.poolId,
                    bump: acc.bump,
                };

                result.push(obligation)
            }
        });
    }

    return result.sort((a, b) => b.timestamp - a.timestamp);
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
            let obligation_status: ObligationStatus = ObligationStatus.Created

            if (ot?.created !== undefined) obligation_status = ObligationStatus.Created
            if (ot?.netted !== undefined) obligation_status = ObligationStatus.Netted
            if (ot?.declined !== undefined) obligation_status = ObligationStatus.Declined
            if (ot?.confirmed !== undefined) obligation_status = ObligationStatus.Confirmed
            if (ot?.cancelled !== undefined) obligation_status = ObligationStatus.Cancelled

            const obligation: Obligation = {
                publicKey: p.publicKey.toBase58(),
                status: obligation_status,
                from: acc.from,
                to: acc.to,
                amount: Number(acc.amount.toString()),
                timestamp: acc.timestamp.toNumber(),  // 👈 BN → number
                sessionId: acc.sessionId,
                fromCancel: acc.fromCancel,
                toCancel: acc.toCancel,
                poolId: acc.poolId,
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
        status: account.status,
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
    const pubkeyBase58 = pubkey.toBase58()

    const [fromPositions, toPositions] = await Promise.all([
        // where from == pubkey
        program.account.netPosition.all([
            {
                memcmp: {
                    offset: 17,
                    bytes: pubkeyBase58,
                },
            },
        ]),

        // where to == pubkey
        program.account.netPosition.all([
            {
                memcmp: {
                    offset: 81,
                    bytes: pubkeyBase58,
                },
            },
        ]),
    ])

    // убираем дубликаты (на всякий случай)
    const map = new Map<string, any>()

        ;[...fromPositions, ...toPositions].forEach(p => {
            map.set(p.publicKey.toBase58(), p)
        })

    const bills = Array.from(map.values())

    return bills
}
