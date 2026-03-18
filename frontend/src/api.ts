import { AnchorProvider, BN, Program, setProvider } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import idl from "./clearing_solana.json"
import type { ClearingSolana } from './clearing_solana';
import { PublicKey, SystemProgram } from '@solana/web3.js';

const { connection } = useConnection();
const wallet = useAnchorWallet()!;

const provider = new AnchorProvider(connection, wallet, {});
setProvider(provider)

export const program = new Program(idl as ClearingSolana, provider)

export async function initEscrow() {
	const authority = wallet.publicKey;

	// PDA escrow
	const [escrow] = PublicKey.findProgramAddressSync(
		[Buffer.from("escrow")],
		program.programId
	);

	// PDA admin
	const [admin] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	await program.methods
		.initEscrow()
		.accounts({
			escrow,
			admin,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function cancelObligation(from: PublicKey, to: PublicKey, timestamp: number) {
	const authority = wallet.publicKey;

	// from_participant
	const [fromParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), from.toBuffer()],
		program.programId
	);

	// to_participant
	const [toParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), to.toBuffer()],
		program.programId
	);

	const ts = new BN(timestamp)

	// PDA admin
	const [obligation] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("obligation"),
			from.toBuffer(),
			to.toBuffer(),
			ts.toArrayLike(Buffer, "le", 8)
		],
		program.programId
	);

	await program.methods
		.cancelObligation(from, to, ts)
		.accounts({
			fromParticipant,
			toParticipant,
			obligation,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function confirmObligation(from: PublicKey, to: PublicKey, timestamp: number) {
	const authority = wallet.publicKey;

	// from_participant
	const [fromParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), from.toBuffer()],
		program.programId
	);

	// to_participant
	const [toParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), to.toBuffer()],
		program.programId
	);

	const ts = new BN(timestamp)

	// PDA admin
	const [obligation] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("obligation"),
			from.toBuffer(),
			to.toBuffer(),
			ts.toArrayLike(Buffer, "le", 8)
		],
		program.programId
	);

	await program.methods
		.confirmObligation(from, to, ts)
		.accounts({
			fromParticipant,
			toParticipant,
			obligation,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function registerObligation(from: PublicKey, to: PublicKey, amount: number, pool_id: number, timestamp: number) {
	const authority = wallet.publicKey;

	// state
	const [state] = PublicKey.findProgramAddressSync(
		[Buffer.from("state")],
		program.programId
	);

	const ts = new BN(timestamp)

	// new_obligation
	const [newObligation] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("obligation"),
			from.toBuffer(),
			to.toBuffer(),
			ts.toArrayLike(Buffer, 'le', 8)
		],
		program.programId
	);

	// participant
	const [participant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	const id = new BN(pool_id)

	// pool
	const [pool] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("pool"),
			id.toArrayLike(Buffer, "le", 4)
		],
		program.programId
	);

	const amt = new BN(amount)

	await program.methods
		.registerObligation(from, to, amt, id, ts)
		.accounts({
			state,
			newObligation,
			participant,
			pool,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function declineObligation(from: PublicKey, to: PublicKey, timestamp: number) {
	const authority = wallet.publicKey;

	const ts = new BN(timestamp)

	// new_obligation
	const [obligation] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("obligation"),
			from.toBuffer(),
			to.toBuffer(),
			ts.toArrayLike(Buffer, 'le', 8)
		],
		program.programId
	);

	// from_participant
	const [fromParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), from.toBuffer()],
		program.programId
	);

	// to_participant
	const [toParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), to.toBuffer()],
		program.programId
	);

	await program.methods
		.declineObligation(from, to, ts)
		.accounts({
			fromParticipant,
			toParticipant,
			obligation,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function processObligation(from: PublicKey, to: PublicKey, timestamp: number) {
	const authority = wallet.publicKey;

	const ts = new BN(timestamp)

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

	// obligation
	const [obligation] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("obligation"),
			from.toBuffer(),
			to.toBuffer(),
			ts.toArrayLike(Buffer, 'le', 8)
		],
		program.programId
	);

	const obligationAccount = await program.account.obligation.fetch(obligation);

	const poolId = new BN(obligationAccount.poolId);

	// pool
	const [pool] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("pool"),
			poolId.toArrayLike(Buffer, "le", 4)
		],
		program.programId
	);

	// from_position
	const [fromPosition] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("position"),
			session.toBuffer(),
			from.toBuffer(),
		],
		program.programId
	);

	// to_position
	const [toPosition] = PublicKey.findProgramAddressSync(
		[
			Buffer.from("position"),
			session.toBuffer(),
			to.toBuffer(),
		],
		program.programId
	);


	await program.methods
		.processObligation(from, to, ts)
		.accounts({
			state,
			session,
			obligation,
			pool,
			fromPosition,
			toPosition,
			payer: authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function finalizeClearingSession() {
	const authority = wallet.publicKey;

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

	await program.methods
		.finalizeClearingSession()
		.accounts({
			state,
			session,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function startClearingSession() {
	const authority = wallet.publicKey;

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

	await program.methods
		.startClearingSession()
		.accounts({
			state,
			session,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function createNewPool(last_pool_id: number) {
	const authority = wallet.publicKey;

	const lastpid = new BN(last_pool_id)
	const nextpid = new BN(last_pool_id + 1)

	// last pool
	const [lastPool] = PublicKey.findProgramAddressSync(
		[Buffer.from("pool"), lastpid.toArrayLike(Buffer, 'le', 4)],
		program.programId
	);

	// new pool
	const [newPool] = PublicKey.findProgramAddressSync(
		[Buffer.from("pool"), nextpid.toArrayLike(Buffer, 'le', 4)],
		program.programId
	);

	await program.methods
		.createNewPool(lastpid)
		.accounts({
			lastPool,
			newPool,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

//	TODO: need to fix logic(remove name_registry?)
export async function registerParticipant(name: string) {
	const authority = wallet.publicKey;

	const nm = new BN(name)

	// state
	const [state] = PublicKey.findProgramAddressSync(
		[Buffer.from("state")],
		program.programId
	);

	// newParticipant
	const [newParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	// name registry
	const [nameRegistry] = PublicKey.findProgramAddressSync(
		[Buffer.from("name_registry"), nm.toArrayLike(Buffer, 'le', 4)],
		program.programId
	);

	await program.methods
		.createNewPool(nm)
		.accounts({
			state,
			newParticipant,
			nameRegistry,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function settle_position(session_id: number, to: PublicKey, timestamp: number) {
	const authority = wallet.publicKey;

	const sid = new BN(session_id);

	// session
	const [session] = PublicKey.findProgramAddressSync(
		[Buffer.from("session"), sid.toArrayLike(Buffer, 'le', 8)],
		program.programId
	);

	// net_position
	const [netPosition] = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), session.toBuffer(), authority.toBuffer()],
		program.programId
	);

	const ts = new BN(timestamp);

	// obligation
	const [obligation] = PublicKey.findProgramAddressSync(
		[Buffer.from("obligation"), authority.toBuffer(), to.toBuffer(), ts.toArrayLike(Buffer, 'le', 8)],
		program.programId
	);

	// recipient
	const recipient = to;

	await program.methods
		.settlePosition(sid, to, ts)
		.accounts({
			session,
			netPosition,
			obligation,
			authority,
			recipient,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function withdrawFee(amount: number) {
	const authority = wallet.publicKey;

	const amt = new BN(amount)

	// escrow
	const [escrow] = PublicKey.findProgramAddressSync(
		[Buffer.from("escrow")],
		program.programId
	);

	await program.methods
		.withdrawFee(amt)
		.accounts({
			escrow,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

// TODO: fix userType enum
export async function updateUserType(participant: PublicKey, userType: any) {
	const authority = wallet.publicKey;

	// admin
	const [admin] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	// target_participant
	const [targetParticipant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), participant.toBuffer()],
		program.programId
	);

	await program.methods
		.updateUserType(participant, userType)
		.accounts({
			admin,
			targetParticipant,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function payFee(session_id: number) {
	const authority = wallet.publicKey;

	const sid = new BN(session_id)

	// escrow
	const [escrow] = PublicKey.findProgramAddressSync(
		[Buffer.from("escrow")],
		program.programId
	);

	// participant
	const [participant] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	// session
	const [session] = PublicKey.findProgramAddressSync(
		[Buffer.from("session"), sid.toArrayLike(Buffer, 'le', 8)],
		program.programId
	);

	// net_position
	const [netPosition] = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), session.toBuffer(), participant.toBuffer()],
		program.programId
	);

	await program.methods
		.payFee(sid)
		.accounts({
			escrow,
			participant,
			session,
			netPosition,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function updateFeeRate(new_rate_bps: number) {
	const authority = wallet.publicKey;

	const nrbps = new BN(new_rate_bps)

	// admin
	const [admin] = PublicKey.findProgramAddressSync(
		[Buffer.from("participant"), authority.toBuffer()],
		program.programId
	);

	// state
	const [state] = PublicKey.findProgramAddressSync(
		[Buffer.from("state")],
		program.programId
	);

	await program.methods
		.updateFeeRate(nrbps)
		.accounts({
			admin,
			state,
			authority,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}
