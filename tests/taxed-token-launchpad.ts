import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TaxedTokenLaunchpad } from "../target/types/taxed_token_launchpad";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import assert from "assert";

describe("taxed-token-launchpad (Token-2022 tests)", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.taxedTokenLaunchpad as Program<TaxedTokenLaunchpad>;

  it("Creates a taxed token and withholds fee on transfer", async () => {
    const payer = provider.wallet as any; // AnchorWallet

    // Keypairs
    const mint = Keypair.generate();
    const recipient = Keypair.generate();

    const decimals = 6;
    const transferFeeBps = 100; // 1%
    const maximumFee = 1_000_000; // large

    // Create the taxed token via program CPI
    console.log('signers:', {
      payer: payer.publicKey.toBase58(),
      mint: mint.publicKey.toBase58(),
      mintAuthority: payer.publicKey.toBase58(),
      feeWithdrawAuthority: payer.publicKey.toBase58(),
    });

    try {
      await program.methods
        .createTaxedToken(decimals, transferFeeBps, new anchor.BN(maximumFee))
        .accounts({
          payer: payer.publicKey,
          mint: mint.publicKey,
          mintAuthority: payer.publicKey,
          feeWithdrawAuthority: payer.publicKey,
          freezeAuthority: payer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([mint])
        .rpc();
    } catch (e) {
      console.error('createTaxedToken error', e.toString());
      throw e;
    }

    // Create associated token accounts for payer and recipient (Token-2022)
    const providerPayer = (provider.wallet as any).payer || payer;

    console.log('creating payer ATA...');
    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      providerPayer,
      mint.publicKey,
      payer.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log('payer ATA created', payerAta.address.toBase58());

    console.log('creating recipient ATA...');
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      providerPayer,
      mint.publicKey,
      recipient.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log('recipient ATA created', recipientAta.address.toBase58());

    // Mint some tokens to payer
    const amountToMint = 1_000_000; // 1 token with 6 decimals, scaled
    console.log('minting tokens...');
    await mintTo(
      provider.connection,
      providerPayer,
      mint.publicKey,
      payerAta.address,
      providerPayer,
      amountToMint,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log('minted tokens');

    // Transfer some tokens from payer to recipient (fee should be withheld)
    const transferAmount = 100_000; // 0.1 token

    // Use transferCheckedWithFee for Token-2022 with transfer fees
    const fee = Math.ceil((transferAmount * transferFeeBps) / 10000);
    console.log('performing transfer with fee', fee);
    // Build raw TransferCheckedWithFee instruction to avoid native BigInt bindings in helpers
    const { TransactionInstruction, Transaction } = require('@solana/web3.js');
    function u64ToBufferLE(n: number | bigint) {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(n));
      return buf;
    }
    const data = Buffer.concat([
      Buffer.from([26, 1]), // TokenInstruction.TransferFeeExtension (26), TransferCheckedWithFee (1)
      u64ToBufferLE(transferAmount),
      Buffer.from([decimals]),
      u64ToBufferLE(fee),
    ]);

    const ix = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: payerAta.address, isSigner: false, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: false },
        { pubkey: recipientAta.address, isSigner: false, isWritable: true },
        { pubkey: providerPayer.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    await provider.sendAndConfirm(new Transaction().add(ix), [providerPayer]);
    console.log('transfer complete');

    // Fetch the recipient account and inspect extension data
    const recipientInfo = await (require('@solana/spl-token').getAccount)(provider.connection, recipientAta.address, undefined, TOKEN_2022_PROGRAM_ID);
    console.log('recipient account:', recipientInfo);
    // The TransferFeeAmount extension will have withheld_amount if fee was taken
    // Accept either a positive withheld amount or check net balance less than transferAmount
    const withheld = recipientInfo.extensions?.transferFeeAmount?.withheldAmount || 0;
    assert((withheld > 0) || (Number(recipientInfo.amount) < transferAmount), "Fee was not withheld");
  });

  it("Creates a soulbound token and prevents transfers", async () => {
    const payer = provider.wallet as any;
    const mint = Keypair.generate();
    const recipient = Keypair.generate();

    // Create soulbound mint
    console.log('signers:', {
      payer: payer.publicKey.toBase58(),
      mint: mint.publicKey.toBase58(),
      mintAuthority: payer.publicKey.toBase58(),
    });

    try {
      await program.methods
        .createSoulboundToken(6)
        .accounts({
          payer: payer.publicKey,
          mint: mint.publicKey,
          mintAuthority: payer.publicKey,
          freezeAuthority: payer.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([mint])
        .rpc();
    } catch (e) {
      console.error('createSoulboundToken error', e.toString());
      throw e;
    }

    const providerPayer = (provider.wallet as any).payer || payer;
    const amountToMint = 1_000_000;

    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      providerPayer,
      mint.publicKey,
      payer.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const recipientAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      providerPayer,
      mint.publicKey,
      recipient.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Mint to payer
    await mintTo(provider.connection, providerPayer, mint.publicKey, payerAta.address, providerPayer, amountToMint, [], undefined, TOKEN_2022_PROGRAM_ID);

    // Attempt transfer - should fail due to non-transferable extension
    let transferFailed = false;
    try {
      // Build raw TransferCheckedWithFee instruction for soulbound transfer (fee 0)
      const { TransactionInstruction, Transaction } = require('@solana/web3.js');
      const feeBuf = Buffer.alloc(8);
      feeBuf.writeBigUInt64LE(BigInt(0));
      const data2 = Buffer.concat([
        Buffer.from([26, 1]), // TokenInstruction.TransferFeeExtension (26), TransferCheckedWithFee (1)
        Buffer.alloc(8, 0), // amount 0 here will be overwritten below
        Buffer.from([6]),
        feeBuf,
      ]);
      // replace amount with desired value (100_000)
      data2.writeBigUInt64LE(BigInt(100_000), 1);

      const ix2 = new TransactionInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        keys: [
          { pubkey: payerAta.address, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: recipientAta.address, isSigner: false, isWritable: true },
          { pubkey: providerPayer.publicKey, isSigner: true, isWritable: false },
        ],
        data: data2,
      });

      await provider.sendAndConfirm(new Transaction().add(ix2), [providerPayer]);
    } catch (e) {
      transferFailed = true;
    }

    assert(transferFailed, "Transfer succeeded unexpectedly for soulbound token");
  });
});
