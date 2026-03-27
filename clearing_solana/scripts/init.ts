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

    // const name = "user1";
    // const nameBytes = new TextEncoder().encode(name);
    //
    // const nameHash = new Uint8Array(32);
    // nameHash.set(nameBytes.slice(0, 32));
    //
    // // 👇 ВАЖНО
    // const nameHashArray = Array.from(nameHash);
    //
    // await program.methods
    //     .registerParticipant(nameHashArray)
    //     .accounts({
    //         authority,
    //     })
    //     .rpc();
    //
    // console.log("User registered");
}

main().catch(console.error);
