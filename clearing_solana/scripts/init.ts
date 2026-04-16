import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../target/types/clearing_solana";
import { Keypair, PublicKey } from "@solana/web3.js";
import "dotenv/config"

import idl from "../target/idl/clearing_solana.json";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = new Program(
	idl as ClearingSolana,
	provider
);

const privateKey = process.env.ADMIN_PRIVATE_KEY;
const fallbackPayer = (provider.wallet as anchor.Wallet & { payer?: Keypair }).payer;
const adminKeypair = privateKey
	? Keypair.fromSecretKey(bs58.decode(privateKey))
	: fallbackPayer;

if (!adminKeypair) {
	throw new Error(
		"ADMIN_PRIVATE_KEY is not set and provider wallet has no payer. Set ADMIN_PRIVATE_KEY or configure ~/.config/solana/id.json"
	);
}

function parseAirdropRecipients(): PublicKey[] {
	const raw = process.env.AIRDROP_ADDRESSES ?? "";
	if (!raw.trim()) return [];

	return raw
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean)
		.map((addr) => new PublicKey(addr));
}

async function main() {
	const authority = adminKeypair.publicKey;

	console.log("Authority:", authority.toBase58());

	const connection = provider.connection;

	const signature = await connection.requestAirdrop(
		authority,
		100 * anchor.web3.LAMPORTS_PER_SOL
	);

	await connection.confirmTransaction(signature);

	console.log("Airdropped 100 SOL");

	const recipients = parseAirdropRecipients();
	const airdropSol = Number(process.env.AIRDROP_SOL ?? "2");

	if (recipients.length > 0) {
		if (!Number.isFinite(airdropSol) || airdropSol <= 0) {
			throw new Error("AIRDROP_SOL must be a positive number");
		}

		const lamports = Math.floor(airdropSol * anchor.web3.LAMPORTS_PER_SOL);
		console.log(`Airdropping ${airdropSol} SOL to ${recipients.length} address(es)...`);

		for (const recipient of recipients) {
			const sig = await connection.requestAirdrop(recipient, lamports);
			await connection.confirmTransaction(sig);
			console.log(`Airdrop sent to ${recipient.toBase58()}`);
		}
	}

	const balance = await connection.getBalance(authority)
	console.log("Balance: ", balance);

	await program.methods
		.initClearingState()
		.accounts({
			authority,
		})
		.signers([adminKeypair])
		.rpc();

	console.log("State initialized");

	await program.methods
		.initAdmin()
		.accounts({ authority })
		.signers([adminKeypair])
		.rpc();

	console.log(`Admin created: ${authority}`);

	await program.methods
		.initEscrow()
		.accounts({
			authority,
		})
		.signers([adminKeypair])
		.rpc();

	console.log("Escrow initialized");

	await program.methods
		.createPoolManager()
		.accounts({
			authority,
		})
		.signers([adminKeypair])
		.rpc();

	console.log("Pool manager initialized");
}

main().catch(console.error);
