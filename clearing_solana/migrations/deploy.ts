// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/clearing_solana.json";
import { ClearingSolana } from "../target/types/clearing_solana";

module.exports = async function (provider: anchor.AnchorProvider) {
    // Configure client to use the provider.
    anchor.setProvider(provider);
    const program = new anchor.Program(
        idl as ClearingSolana,
        provider
    );
    const authority = provider.wallet.publicKey;

    const [statePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );
    const [adminPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("participant"), authority.toBuffer()],
        program.programId
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow")],
        program.programId
    );
    const [rootPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.alloc(4)],
        program.programId
    );
    const [poolManagerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_manager")],
        program.programId
    );

    const ensureInit = async (
        name: string,
        pda: PublicKey,
        run: () => Promise<string>
    ) => {
        const existing = await provider.connection.getAccountInfo(pda, "confirmed");
        if (existing) {
            console.log(`[deploy] ${name} already initialized: ${pda.toBase58()}`);
            return;
        }
        const sig = await run();
        console.log(`[deploy] ${name} initialized: ${sig}`);
    };

    // Optional airdrop step:
    // AIRDROP_ADDRESSES="addr1,addr2,addr3"
    // AIRDROP_SOL="2"
    const rawRecipients = process.env.AIRDROP_ADDRESSES ?? "";
    const recipients = rawRecipients
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

    if (recipients.length === 0) {
        return;
    }

    const airdropSol = Number(process.env.AIRDROP_SOL ?? "2");
    if (!Number.isFinite(airdropSol) || airdropSol <= 0) {
        throw new Error("AIRDROP_SOL must be a positive number");
    }

    const lamports = Math.floor(airdropSol * LAMPORTS_PER_SOL);
    console.log(
        `[deploy] Running airdrop: ${airdropSol} SOL to ${recipients.length} recipient(s)`
    );

    for (const recipient of recipients) {
        try {
            const pubkey = new PublicKey(recipient);
            const signature = await provider.connection.requestAirdrop(pubkey, lamports);
            await provider.connection.confirmTransaction(signature, "confirmed");
            console.log(`[deploy] Airdrop success: ${recipient} (${signature})`);
        } catch (error) {
            // Keep deployment resilient on networks where faucet/airdrop is unavailable.
            console.warn(`[deploy] Airdrop skipped/failed for ${recipient}:`, error);
        }
    }

    await ensureInit("clearing state", statePda, async () =>
        program.methods
            .initClearingState()
            .accounts({ authority })
            .rpc()
    );

    await ensureInit("admin participant", adminPda, async () =>
        program.methods
            .initAdmin()
            .accounts({ authority })
            .rpc()
    );

    await ensureInit("escrow", escrowPda, async () =>
        program.methods
            .initEscrow()
            .accounts({ authority })
            .rpc()
    );

    await ensureInit("pool manager", poolManagerPda, async () =>
        program.methods
            .createPoolManager()
            .accounts({ authority })
            .rpc()
    );

    // Root pool is created by createPoolManager, but check it explicitly for visibility.
    const rootPoolInfo = await provider.connection.getAccountInfo(rootPoolPda, "confirmed");
    if (!rootPoolInfo) {
        throw new Error("[deploy] root pool was not created by createPoolManager");
    }
};
