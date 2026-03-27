import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClearingSolana } from "../target/types/clearing_solana";

import idl from "../target/idl/clearing_solana.json";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = new Program(
    idl as ClearingSolana,
    provider
);

async function main() {
    const authority = provider.wallet.publicKey;

    console.log("Authority:", authority.toBase58());

    await program.methods
        .initClearingState()
        .accounts({
            authority,
        })
        .rpc();

    console.log("State initialized");

    await program.methods
        .initAdmin()
        .accounts({ authority })
        .rpc();

    console.log(`Admin created: ${authority}`);

    await program.methods
        .initEscrow()
        .accounts({
            authority,
        })
        .rpc();

    console.log("Escrow initialized");

    await program.methods
        .createPoolManager()
        .accounts({
            authority,
        })
        .rpc();

    console.log("Pool manager initialized");
}

main().catch(console.error);
