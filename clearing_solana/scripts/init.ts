import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../target/types/clearing_solana";
import { Keypair } from "@solana/web3.js";
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

const adminKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));

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
