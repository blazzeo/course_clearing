import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { ClearingSolana } from "../target/types/clearing_solana";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";

describe("clearing_solana", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.clearingSolana as Program<ClearingSolana>;
  const admin = provider.wallet;

  const statePda = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  )[0];
  const escrowPda = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow")],
    program.programId
  )[0];
  const rootPoolPda = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), Buffer.alloc(4)],
    program.programId
  )[0];

  const participantPda = (authority: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("participant"), authority.toBuffer()],
      program.programId
    )[0];

  const sessionPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("session"), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const obligationPda = (from: PublicKey, to: PublicKey, ts: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("obligation"),
        from.toBuffer(),
        to.toBuffer(),
        new BN(ts).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

  const positionPda = (session: PublicKey, debtor: PublicKey, creditor: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), session.toBuffer(), debtor.toBuffer(), creditor.toBuffer()],
      program.programId
    )[0];

  const nameHash = (name: string): number[] =>
    Array.from(createHash("sha256").update(name.trim().toLowerCase()).digest());

  const airdrop = async (pubkey: PublicKey, sol: number) => {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const accountExists = async (pda: PublicKey) => {
    const info = await provider.connection.getAccountInfo(pda, "confirmed");
    return info !== null;
  };

  const registerParticipant = async (kp: Keypair, name: string) => {
    const nh = nameHash(name);
    const nameRegistry = PublicKey.findProgramAddressSync(
      [Buffer.from("name_registry"), Uint8Array.from(nh)],
      program.programId
    )[0];
    await program.methods
      .registerParticipant(nh, name)
      .accounts({
        state: statePda,
        newParticipant: participantPda(kp.publicKey),
        nameRegistry,
        authority: kp.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();
  };

  const expectAnchorError = async (fn: () => Promise<unknown>, code: string) => {
    try {
      await fn();
      expect.fail(`Expected Anchor error ${code}`);
    } catch (e) {
      expect(`${e}`).to.include(code);
    }
  };

  const registerAndConfirmObligation = async (
    from: Keypair,
    to: Keypair,
    amount: number,
    timestamp: number
  ) => {
    await program.methods
      .registerObligation(from.publicKey, to.publicKey, new BN(amount), 0, new BN(timestamp))
      .accounts({
        state: statePda,
        newObligation: obligationPda(from.publicKey, to.publicKey, timestamp),
        participant: participantPda(to.publicKey),
        pool: rootPoolPda,
        authority: to.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([to])
      .rpc();
    await program.methods
      .confirmObligation(from.publicKey, to.publicKey, new BN(timestamp))
      .accounts({
        fromParticipant: participantPda(from.publicKey),
        toParticipant: participantPda(to.publicKey),
        obligation: obligationPda(from.publicKey, to.publicKey, timestamp),
        authority: from.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([from])
      .rpc();
  };

  before(async () => {
    const ignoreIfAlreadyInitialized = (e: unknown) => {
      const msg = `${e}`;
      if (
        msg.includes("AdminAlreadyExists") ||
        msg.includes("already in use") ||
        msg.includes("already exists")
      ) {
        return;
      }
      throw e;
    };

    if (!(await accountExists(statePda))) {
      try {
        await program.methods
          .initClearingState()
          .accounts({
            state: statePda,
            authority: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        ignoreIfAlreadyInitialized(e);
      }
    }

    if (!(await accountExists(participantPda(admin.publicKey)))) {
      try {
        await program.methods
          .initAdmin()
          .accounts({
            state: statePda,
            admin: participantPda(admin.publicKey),
            authority: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        ignoreIfAlreadyInitialized(e);
      }
    }

    if (!(await accountExists(escrowPda))) {
      try {
        await program.methods
          .initEscrow()
          .accounts({
            escrow: escrowPda,
            admin: participantPda(admin.publicKey),
            authority: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        ignoreIfAlreadyInitialized(e);
      }
    }

    const poolManagerPda = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_manager")],
      program.programId
    )[0];
    if (!(await accountExists(poolManagerPda))) {
      try {
        await program.methods
          .createPoolManager()
          .accounts({
            state: statePda,
            rootPool: rootPoolPda,
            poolManager: poolManagerPda,
            authority: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } catch (e) {
        ignoreIfAlreadyInitialized(e);
      }
    }
  });

  it("cycle 5-5-5 is fully netted internally", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const c = Keypair.generate();
    await airdrop(a.publicKey, 20);
    await airdrop(b.publicKey, 20);
    await airdrop(c.publicKey, 20);
    await registerParticipant(a, `a_user_${Date.now()}_1`);
    await registerParticipant(b, `b_user_${Date.now()}_2`);
    await registerParticipant(c, `c_user_${Date.now()}_3`);

    const t1 = Math.floor(Date.now() / 1000) + 1;
    const t2 = t1 + 1;
    const t3 = t1 + 2;

    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(5_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .registerObligation(b.publicKey, c.publicKey, new BN(5_000_000_000), 0, new BN(t2))
      .accounts({ state: statePda, newObligation: obligationPda(b.publicKey, c.publicKey, t2), participant: participantPda(c.publicKey), pool: rootPoolPda, authority: c.publicKey, systemProgram: SystemProgram.programId })
      .signers([c])
      .rpc();
    await program.methods
      .registerObligation(c.publicKey, a.publicKey, new BN(5_000_000_000), 0, new BN(t3))
      .accounts({ state: statePda, newObligation: obligationPda(c.publicKey, a.publicKey, t3), participant: participantPda(a.publicKey), pool: rootPoolPda, authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();
    await program.methods
      .confirmObligation(b.publicKey, c.publicKey, new BN(t2))
      .accounts({ fromParticipant: participantPda(b.publicKey), toParticipant: participantPda(c.publicKey), obligation: obligationPda(b.publicKey, c.publicKey, t2), authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .confirmObligation(c.publicKey, a.publicKey, new BN(t3))
      .accounts({ fromParticipant: participantPda(c.publicKey), toParticipant: participantPda(a.publicKey), obligation: obligationPda(c.publicKey, a.publicKey, t3), authority: c.publicKey, systemProgram: SystemProgram.programId })
      .signers([c])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(3))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    for (const [from, to, ts] of [[a.publicKey, b.publicKey, t1], [b.publicKey, c.publicKey, t2], [c.publicKey, a.publicKey, t3]] as [PublicKey, PublicKey, number][]) {
      await (program as any).methods
        .applyInternalNetting(from, to, new BN(ts), new BN(5_000_000_000))
        .accounts({
          state: statePda,
          session: sess,
          obligation: obligationPda(from, to, ts),
          pool: rootPoolPda,
          authority: admin.publicKey,
        })
        .rpc();
    }

    await program.methods
      .finalizeClearingSession()
      .accounts({ state: statePda, session: sess, authority: admin.publicKey })
      .rpc();

    const o1 = await program.account.obligation.fetch(obligationPda(a.publicKey, b.publicKey, t1));
    const o2 = await program.account.obligation.fetch(obligationPda(b.publicKey, c.publicKey, t2));
    const o3 = await program.account.obligation.fetch(obligationPda(c.publicKey, a.publicKey, t3));
    expect(Number(o1.amount.toString())).eq(0);
    expect(Number(o2.amount.toString())).eq(0);
    expect(Number(o3.amount.toString())).eq(0);
  });

  it("partial netting leaves remainder for settlement", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    await airdrop(a.publicKey, 20);
    await airdrop(b.publicKey, 20);
    await registerParticipant(a, `a_user_${Date.now()}_4`);
    await registerParticipant(b, `b_user_${Date.now()}_5`);

    const t1 = Math.floor(Date.now() / 1000) + 100;
    const t2 = t1 + 1;
    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(10_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .registerObligation(b.publicKey, a.publicKey, new BN(4_000_000_000), 0, new BN(t2))
      .accounts({ state: statePda, newObligation: obligationPda(b.publicKey, a.publicKey, t2), participant: participantPda(a.publicKey), pool: rootPoolPda, authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();
    await program.methods
      .confirmObligation(b.publicKey, a.publicKey, new BN(t2))
      .accounts({ fromParticipant: participantPda(b.publicKey), toParticipant: participantPda(a.publicKey), obligation: obligationPda(b.publicKey, a.publicKey, t2), authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(3))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    await (program as any).methods
      .applyInternalNetting(a.publicKey, b.publicKey, new BN(t1), new BN(4_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(a.publicKey, b.publicKey, t1), pool: rootPoolPda, authority: admin.publicKey })
      .rpc();
    await (program as any).methods
      .applyInternalNetting(b.publicKey, a.publicKey, new BN(t2), new BN(4_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(b.publicKey, a.publicKey, t2), pool: rootPoolPda, authority: admin.publicKey })
      .rpc();

    await (program as any).methods
      .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(6_000_000_000))
      .accounts({
        state: statePda,
        session: sess,
        obligation: obligationPda(a.publicKey, b.publicKey, t1),
        pool: rootPoolPda,
        pairPosition: positionPda(sess, a.publicKey, b.publicKey),
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await (program as any).methods
      .payFee(new BN(nextSession), b.publicKey)
      .accounts({
        escrow: escrowPda,
        participant: participantPda(a.publicKey),
        session: sess,
        netPosition: positionPda(sess, a.publicKey, b.publicKey),
        authority: a.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([a])
      .rpc();

    await (program as any).methods
      .settlePosition(new BN(nextSession), b.publicKey, new BN(6_000_000_000))
      .accounts({
        session: sess,
        netPosition: positionPda(sess, a.publicKey, b.publicKey),
        authority: a.publicKey,
        recipient: b.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([a])
      .rpc();

    await program.methods
      .finalizeClearingSession()
      .accounts({ state: statePda, session: sess, authority: admin.publicKey })
      .rpc();

    const oAb = await program.account.obligation.fetch(obligationPda(a.publicKey, b.publicKey, t1));
    const oBa = await program.account.obligation.fetch(obligationPda(b.publicKey, a.publicKey, t2));
    const pos = await program.account.netPosition.fetch(positionPda(sess, a.publicKey, b.publicKey));
    expect(Number(oAb.amount.toString())).eq(0);
    expect(Number(oBa.amount.toString())).eq(0);
    expect(Number(pos.netAmount.toString())).eq(0);
  });

  it("rejects allocation larger than remaining obligation amount", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    await airdrop(a.publicKey, 10);
    await airdrop(b.publicKey, 10);
    await registerParticipant(a, `a_user_${Date.now()}_6`);
    await registerParticipant(b, `b_user_${Date.now()}_7`);

    const t1 = Math.floor(Date.now() / 1000) + 200;
    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(2_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(1))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    await expectAnchorError(
      () =>
        (program as any).methods
          .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(3_000_000_000))
          .accounts({
            state: statePda,
            session: sess,
            obligation: obligationPda(a.publicKey, b.publicKey, t1),
            pool: rootPoolPda,
            pairPosition: positionPda(sess, a.publicKey, b.publicKey),
            payer: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      "InvalidAllocationAmount"
    );
  });

  it("supports multi-step partial create_position and full settlement", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    await airdrop(a.publicKey, 20);
    await airdrop(b.publicKey, 20);
    await registerParticipant(a, `a_user_${Date.now()}_8`);
    await registerParticipant(b, `b_user_${Date.now()}_9`);

    const t1 = Math.floor(Date.now() / 1000) + 300;
    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(9_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(1))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const posPda = positionPda(sess, a.publicKey, b.publicKey);
    await (program as any).methods
      .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(3_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(a.publicKey, b.publicKey, t1), pool: rootPoolPda, pairPosition: posPda, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    await (program as any).methods
      .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(6_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(a.publicKey, b.publicKey, t1), pool: rootPoolPda, pairPosition: posPda, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const posBeforeSettle = await program.account.netPosition.fetch(posPda);
    expect(Number(posBeforeSettle.netAmount.toString())).eq(9_000_000_000);

    await (program as any).methods
      .payFee(new BN(nextSession), b.publicKey)
      .accounts({
        escrow: escrowPda,
        participant: participantPda(a.publicKey),
        session: sess,
        netPosition: posPda,
        authority: a.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([a])
      .rpc();

    await (program as any).methods
      .settlePosition(new BN(nextSession), b.publicKey, new BN(9_000_000_000))
      .accounts({
        session: sess,
        netPosition: posPda,
        authority: a.publicKey,
        recipient: b.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([a])
      .rpc();

    await program.methods
      .finalizeClearingSession()
      .accounts({ state: statePda, session: sess, authority: admin.publicKey })
      .rpc();

    const obligation = await program.account.obligation.fetch(obligationPda(a.publicKey, b.publicKey, t1));
    const posAfterSettle = await program.account.netPosition.fetch(posPda);
    expect(Number(obligation.amount.toString())).eq(0);
    expect(Number(posAfterSettle.netAmount.toString())).eq(0);
  });

  it("rejects zero allocation for internal netting", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    await airdrop(a.publicKey, 10);
    await airdrop(b.publicKey, 10);
    await registerParticipant(a, `a_user_${Date.now()}_10`);
    await registerParticipant(b, `b_user_${Date.now()}_11`);

    const t1 = Math.floor(Date.now() / 1000) + 400;
    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(1_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(1))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    await expectAnchorError(
      () =>
        (program as any).methods
          .applyInternalNetting(a.publicKey, b.publicKey, new BN(t1), new BN(0))
          .accounts({
            state: statePda,
            session: sess,
            obligation: obligationPda(a.publicKey, b.publicKey, t1),
            pool: rootPoolPda,
            authority: admin.publicKey,
          })
          .rpc(),
      "InvalidAllocationAmount"
    );
  });

  it("rejects netting actions after session is finalized", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    await airdrop(a.publicKey, 10);
    await airdrop(b.publicKey, 10);
    await registerParticipant(a, `a_user_${Date.now()}_12`);
    await registerParticipant(b, `b_user_${Date.now()}_13`);

    const t1 = Math.floor(Date.now() / 1000) + 500;
    await program.methods
      .registerObligation(a.publicKey, b.publicKey, new BN(2_000_000_000), 0, new BN(t1))
      .accounts({ state: statePda, newObligation: obligationPda(a.publicKey, b.publicKey, t1), participant: participantPda(b.publicKey), pool: rootPoolPda, authority: b.publicKey, systemProgram: SystemProgram.programId })
      .signers([b])
      .rpc();
    await program.methods
      .confirmObligation(a.publicKey, b.publicKey, new BN(t1))
      .accounts({ fromParticipant: participantPda(a.publicKey), toParticipant: participantPda(b.publicKey), obligation: obligationPda(a.publicKey, b.publicKey, t1), authority: a.publicKey, systemProgram: SystemProgram.programId })
      .signers([a])
      .rpc();

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(1))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    await program.methods
      .finalizeClearingSession()
      .accounts({ state: statePda, session: sess, authority: admin.publicKey })
      .rpc();

    await expectAnchorError(
      () =>
        (program as any).methods
          .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(1_000_000_000))
          .accounts({
            state: statePda,
            session: sess,
            obligation: obligationPda(a.publicKey, b.publicKey, t1),
            pool: rootPoolPda,
            pairPosition: positionPda(sess, a.publicKey, b.publicKey),
            payer: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      "InvalidSessionStatus"
    );
  });

  it("mixed workflow (internal + partial + external) closes all obligations", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const c = Keypair.generate();
    const d = Keypair.generate();
    await airdrop(a.publicKey, 20);
    await airdrop(b.publicKey, 20);
    await airdrop(c.publicKey, 20);
    await airdrop(d.publicKey, 20);
    await registerParticipant(a, `a_user_${Date.now()}_14`);
    await registerParticipant(b, `b_user_${Date.now()}_15`);
    await registerParticipant(c, `c_user_${Date.now()}_16`);
    await registerParticipant(d, `d_user_${Date.now()}_17`);

    const baseTs = Math.floor(Date.now() / 1000) + 650;
    const t1 = baseTs;
    const t2 = baseTs + 1;
    const t3 = baseTs + 2;
    const t4 = baseTs + 3;
    const t5 = baseTs + 4;

    await registerAndConfirmObligation(a, b, 8_000_000_000, t1); // external
    await registerAndConfirmObligation(b, c, 5_000_000_000, t2); // partial internal + external
    await registerAndConfirmObligation(c, a, 3_000_000_000, t3); // full internal
    await registerAndConfirmObligation(d, a, 4_000_000_000, t4); // external
    await registerAndConfirmObligation(c, d, 2_000_000_000, t5); // external

    const stateBefore = await program.account.clearingState.fetch(statePda);
    const nextSession = Number(stateBefore.totalSessions.toString()) + 1;
    const sess = sessionPda(nextSession);
    await program.methods
      .startClearingSession(new BN(5))
      .accounts({ state: statePda, session: sess, authority: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    // Internal part from solver result
    await (program as any).methods
      .applyInternalNetting(c.publicKey, a.publicKey, new BN(t3), new BN(3_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(c.publicKey, a.publicKey, t3), pool: rootPoolPda, authority: admin.publicKey })
      .rpc();
    await (program as any).methods
      .applyInternalNetting(b.publicKey, c.publicKey, new BN(t2), new BN(2_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(b.publicKey, c.publicKey, t2), pool: rootPoolPda, authority: admin.publicKey })
      .rpc();

    // External positions for residual graph
    const abPos = positionPda(sess, a.publicKey, b.publicKey);
    const bcPos = positionPda(sess, b.publicKey, c.publicKey);
    const daPos = positionPda(sess, d.publicKey, a.publicKey);
    const cdPos = positionPda(sess, c.publicKey, d.publicKey);

    await (program as any).methods
      .createPosition(a.publicKey, b.publicKey, new BN(t1), new BN(8_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(a.publicKey, b.publicKey, t1), pool: rootPoolPda, pairPosition: abPos, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    await (program as any).methods
      .createPosition(b.publicKey, c.publicKey, new BN(t2), new BN(3_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(b.publicKey, c.publicKey, t2), pool: rootPoolPda, pairPosition: bcPos, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    await (program as any).methods
      .createPosition(d.publicKey, a.publicKey, new BN(t4), new BN(4_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(d.publicKey, a.publicKey, t4), pool: rootPoolPda, pairPosition: daPos, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    await (program as any).methods
      .createPosition(c.publicKey, d.publicKey, new BN(t5), new BN(2_000_000_000))
      .accounts({ state: statePda, session: sess, obligation: obligationPda(c.publicKey, d.publicKey, t5), pool: rootPoolPda, pairPosition: cdPos, payer: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const settlePair = async (debtor: Keypair, creditor: Keypair, pos: PublicKey, amount: number) => {
      await (program as any).methods
        .payFee(new BN(nextSession), creditor.publicKey)
        .accounts({
          escrow: escrowPda,
          participant: participantPda(debtor.publicKey),
          session: sess,
          netPosition: pos,
          authority: debtor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([debtor])
        .rpc();
      await (program as any).methods
        .settlePosition(new BN(nextSession), creditor.publicKey, new BN(amount))
        .accounts({
          session: sess,
          netPosition: pos,
          authority: debtor.publicKey,
          recipient: creditor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([debtor])
        .rpc();
    };

    await settlePair(a, b, abPos, 8_000_000_000);
    await settlePair(b, c, bcPos, 3_000_000_000);
    await settlePair(d, a, daPos, 4_000_000_000);
    await settlePair(c, d, cdPos, 2_000_000_000);

    await program.methods
      .finalizeClearingSession()
      .accounts({ state: statePda, session: sess, authority: admin.publicKey })
      .rpc();

    const obs = await Promise.all([
      program.account.obligation.fetch(obligationPda(a.publicKey, b.publicKey, t1)),
      program.account.obligation.fetch(obligationPda(b.publicKey, c.publicKey, t2)),
      program.account.obligation.fetch(obligationPda(c.publicKey, a.publicKey, t3)),
      program.account.obligation.fetch(obligationPda(d.publicKey, a.publicKey, t4)),
      program.account.obligation.fetch(obligationPda(c.publicKey, d.publicKey, t5)),
    ]);
    for (const ob of obs) {
      expect(Number(ob.amount.toString())).eq(0);
    }

    const positions = await Promise.all([
      program.account.netPosition.fetch(abPos),
      program.account.netPosition.fetch(bcPos),
      program.account.netPosition.fetch(daPos),
      program.account.netPosition.fetch(cdPos),
    ]);
    for (const p of positions) {
      expect(Number(p.netAmount.toString())).eq(0);
    }
  });
});
