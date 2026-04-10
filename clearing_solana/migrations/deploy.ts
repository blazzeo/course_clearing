// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

module.exports = async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

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
};
