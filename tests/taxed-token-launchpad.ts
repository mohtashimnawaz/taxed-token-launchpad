import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TaxedTokenLaunchpad } from "../target/types/taxed_token_launchpad";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Token,
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

    // Wrap mint with Token-2022 client
    const token = new Token(
      provider.connection,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
      payer // wallet with signing capability
    );

    // Create associated token accounts for payer and recipient
    const payerAta = await token.getOrCreateAssociatedAccountInfo(payer.publicKey);
    const recipientAta = await token.getOrCreateAssociatedAccountInfo(recipient.publicKey);

    // Mint some tokens to payer
    const amountToMint = 1_000_000; // 1 token with 6 decimals, scaled

    await token.mintTo(
      payerAta.address,
      payer.publicKey,
      [],
      amountToMint
    );

    // Transfer some tokens from payer to recipient (fee should be withheld)
    const transferAmount = 100_000; // 0.1 token

    await token.transfer(
      payerAta.address,
      recipientAta.address,
      payer.publicKey,
      [],
      transferAmount
    );

    // Fetch the recipient account and ensure withheld amount > 0
    const recipientInfo = await token.getAccountInfo(recipientAta.address);

    // For Token-2022, withheldAmount is a BigInt/BN-like property
    // Convert to Number for assert (it should be non-zero)
    assert(recipientInfo.withheldAmount && recipientInfo.withheldAmount.toNumber() > 0, "Fee was not withheld");
  });

  it("Creates a soulbound token and prevents transfers", async () => {
    const payer = provider.wallet as any;
    const mint = Keypair.generate();
    const recipient = Keypair.generate();

    // Create soulbound mint
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

    const token = new Token(provider.connection, mint.publicKey, TOKEN_2022_PROGRAM_ID, payer);

    const payerAta = await token.getOrCreateAssociatedAccountInfo(payer.publicKey);
    const recipientAta = await token.getOrCreateAssociatedAccountInfo(recipient.publicKey);

    // Mint to payer
    await token.mintTo(payerAta.address, payer.publicKey, [], 1_000_000);

    // Attempt transfer - should fail due to non-transferable extension
    let transferFailed = false;
    try {
      await token.transfer(payerAta.address, recipientAta.address, payer.publicKey, [], 100_000);
    } catch (e) {
      transferFailed = true;
    }

    assert(transferFailed, "Transfer succeeded unexpectedly for soulbound token");
  });
});
