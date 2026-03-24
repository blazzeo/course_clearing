import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import idl from "./clearing_solana.json"
import type { ClearingSolana } from './clearing_solana';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';

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
) {
    return await program.account.participant.fetchNullable(pda);
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

export async function cancelObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    return await program.methods
        .cancelObligation(from, to, ts)
        .accounts({
            authority,
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

export async function declineObligation(program: Program<ClearingSolana>, from: PublicKey, to: PublicKey, timestamp: number) {
    const authority = program.provider.publicKey;

    const ts = new BN(timestamp)

    return await program.methods
        .declineObligation(from, to, ts)
        .accounts({
            authority,
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

//	TODO: need to fix logic(remove name_registry?)
export async function registerParticipant(program: Program<ClearingSolana>, nameHash: number[]) {
    const authority = program.provider.publicKey;

    const encoder = new TextEncoder();

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
        .registerParticipant(nameHash)
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

export async function getClearingState(program: Program<ClearingSolana>) {
    const encoder = new TextEncoder()

    const [statePda] = PublicKey.findProgramAddressSync(
        [encoder.encode("state")],
        program.programId
    )

    return await program.account.clearingState.fetch(statePda)
}

export async function getUserRole(
    program: Program<ClearingSolana>,
    publicKey: PublicKey
): Promise<string> {
    try {
        const participantPda = getParticipantPda(program.programId, publicKey)

        const participant = await program.account.participant.fetch(participantPda)

        const ut = participant.userType

        if (ut?.participant !== undefined) return 'counterparty'
        if (ut?.admin !== undefined) return 'administrator'
        if (ut?.officer !== undefined) return 'auditor'

        return 'guest'
    } catch {
        return 'guest'
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

export async function getObligations(
    program: Program<ClearingSolana>,
) {
    return await program.account.obligation.all()
}

export async function getObligationsByParticipant(
    program: Program<ClearingSolana>,
    pubkey: PublicKey
) {
    const pubkeyBase58 = pubkey.toBase58()

    const [fromPositions, toPositions] = await Promise.all([
        // where from == pubkey
        program.account.obligation.all([
            {
                memcmp: {
                    offset: 9,
                    bytes: pubkeyBase58,
                },
            },
        ]),

        // where to == pubkey
        program.account.obligation.all([
            {
                memcmp: {
                    offset: 41,
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

    return Array.from(map.values())
}

export async function getBills(
    program: Program<ClearingSolana>,
) {
    return await program.account.netPosition.all()
}

export async function getBiilsByParticipant(
    program: Program<ClearingSolana>,
    pubkey: PublicKey
) {
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

    return Array.from(map.values())
}
