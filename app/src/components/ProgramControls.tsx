import React, { useCallback, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import idl from '../../../target/idl/taxed_token_launchpad.json'
import { Program } from '@coral-xyz/anchor'
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  withdrawWithheldTokensFromMint,
} from '@solana/spl-token'

const PROGRAM_ID = new PublicKey(idl.address)

export default function ProgramControls() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [logs, setLogs] = useState<string[]>([])
  const [selectedMint, setSelectedMint] = useState<PublicKey | null>(null)
  const [payerAta, setPayerAta] = useState<PublicKey | null>(null)
  const [payerBalance, setPayerBalance] = useState<string>('0')
  const [mintAmount, setMintAmount] = useState<number>(1000000)

  const pushLog = (s: string) => setLogs((l) => [s, ...l].slice(0, 20))

  const loadProgram = useCallback((): Program | null => {
    if (!wallet.publicKey) {
      pushLog('Wallet not connected')
      return null
    }
    const provider = new anchor.AnchorProvider(connection, wallet as any, anchor.AnchorProvider.defaultOptions())
    const program = new anchor.Program(idl as any, PROGRAM_ID, provider)
    pushLog('Program loaded: ' + PROGRAM_ID.toBase58())
    return program
  }, [connection, wallet])

  const createTaxedToken = useCallback(async () => {
    const program = loadProgram()
    if (!program) return
    const mint = Keypair.generate()
    const decimals = 6
    const transferFeeBps = 100 // 1%
    const maximumFee = new anchor.BN(1_000_000)

    pushLog('Creating taxed token, mint: ' + mint.publicKey.toBase58())
    try {
      const sig = await program.methods
        .createTaxedToken(decimals, transferFeeBps, maximumFee)
        .accounts({
          payer: wallet.publicKey,
          mint: mint.publicKey,
          mintAuthority: wallet.publicKey,
          feeWithdrawAuthority: wallet.publicKey,
          freezeAuthority: wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mint])
        .rpc()

      pushLog('createTaxedToken succeeded: ' + sig)
      setSelectedMint(mint.publicKey)
    } catch (e: any) {
      pushLog('createTaxedToken failed: ' + (e.message || e.toString()))
    }
  }, [loadProgram, wallet])

  const createSoulboundToken = useCallback(async () => {
    const program = loadProgram()
    if (!program) return
    const mint = Keypair.generate()
    const decimals = 6
    pushLog('Creating soulbound token, mint: ' + mint.publicKey.toBase58())
    try {
      const sig = await program.methods
        .createSoulboundToken(decimals)
        .accounts({
          payer: wallet.publicKey,
          mint: mint.publicKey,
          mintAuthority: wallet.publicKey,
          freezeAuthority: wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mint])
        .rpc()
      pushLog('createSoulboundToken succeeded: ' + sig)
      setSelectedMint(mint.publicKey)
    } catch (e: any) {
      pushLog('createSoulboundToken failed: ' + (e.message || e.toString()))
    }
  }, [loadProgram, wallet])

  const createPayerAta = useCallback(async () => {
    if (!selectedMint) {
      pushLog('No mint selected')
      return
    }
    if (!wallet.publicKey) {
      pushLog('Wallet not connected')
      return
    }

    try {
      const ata = await getAssociatedTokenAddress(selectedMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      const info = await connection.getAccountInfo(ata)
      if (info) {
        pushLog('Payer ATA already exists: ' + ata.toBase58())
        setPayerAta(ata)
        return
      }

      const ix = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ata,
        wallet.publicKey,
        selectedMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const tx = new Transaction().add(ix)
      const sig = await wallet.sendTransaction(tx, connection)
      await connection.confirmTransaction(sig, 'confirmed')
      pushLog('Created payer ATA: ' + ata.toBase58() + ' (' + sig + ')')
      setPayerAta(ata)
    } catch (e: any) {
      pushLog('createPayerAta failed: ' + (e.message || e.toString()))
    }
  }, [selectedMint, connection, wallet])

  const mintToPayer = useCallback(async (amount?: number) => {
    if (!selectedMint || !payerAta) {
      pushLog('Missing mint or payer ATA')
      return
    }
    if (!wallet.publicKey) {
      pushLog('Wallet not connected')
      return
    }
    const amt = BigInt((amount ?? mintAmount))
    try {
      const ix = createMintToInstruction(selectedMint, payerAta, wallet.publicKey, amt, [], TOKEN_2022_PROGRAM_ID)
      const tx = new Transaction().add(ix)
      const sig = await wallet.sendTransaction(tx, connection)
      await connection.confirmTransaction(sig, 'confirmed')
      pushLog('mintTo succeeded: ' + sig + ' amount: ' + amt.toString())
    } catch (e: any) {
      pushLog('mintTo failed: ' + (e.message || e.toString()))
    }
  }, [selectedMint, payerAta, wallet, connection, mintAmount])

  const refreshPayerBalance = useCallback(async () => {
    if (!payerAta) {
      pushLog('No payer ATA')
      return
    }
    try {
      const acc = await getAccount(connection, payerAta, undefined, TOKEN_2022_PROGRAM_ID)
      const amount = acc.amount?.toString?.() ?? String(acc.amount)
      setPayerBalance(amount)
      const withheld = (acc as any).extensions?.transferFeeAmount?.withheldAmount || 0
      pushLog('Payer ATA balance: ' + amount + ' withheld: ' + withheld)
    } catch (e: any) {
      pushLog('refreshPayerBalance failed: ' + (e.message || e.toString()))
    }
  }, [payerAta, connection])

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, maxWidth: 720 }}>
      <h2>Program Controls</h2>
      <div>
        <strong>Program:</strong> {PROGRAM_ID.toBase58()}
      </div>
      <div>
        <strong>Wallet:</strong> {wallet.publicKey ? wallet.publicKey.toBase58() : 'Not connected'}
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={() => loadProgram()} style={{ marginRight: 8 }}>
          Load Program
        </button>
        <button onClick={createTaxedToken} style={{ marginRight: 8 }} disabled={!wallet.connected}>
          Create Taxed Token
        </button>
        <button onClick={createSoulboundToken} disabled={!wallet.connected}>
          Create Soulbound Token
        </button>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
        <h3>Token Helpers</h3>
        <div>
          <div><strong>Selected Mint:</strong> {selectedMint ? selectedMint.toBase58() : 'None'}</div>
          <div style={{ marginTop: 8 }}>
            <button onClick={createPayerAta} disabled={!wallet.connected || !selectedMint} style={{ marginRight: 8 }}>
              Create / Get Payer ATA
            </button>
            <input type="number" value={mintAmount} onChange={(e) => setMintAmount(Number(e.target.value))} style={{ width: 140, marginRight: 8 }} />
            <button onClick={() => mintToPayer()} disabled={!wallet.connected || !payerAta}>
              Mint to Payer ATA
            </button>
            <button onClick={refreshPayerBalance} disabled={!payerAta} style={{ marginLeft: 8 }}>
              Refresh Balance
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>Payer ATA:</strong> {payerAta ? payerAta.toBase58() : 'None'} <br />
            <strong>Balance:</strong> {payerBalance}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
        <h3>Recipient Controls</h3>
        <div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="recipient pubkey" id="recipientPubkey" style={{ width: 380, marginRight: 8 }} />
            <button onClick={async () => {
              const el = document.getElementById('recipientPubkey') as HTMLInputElement
              const v = el.value.trim()
              if (!v) { pushLog('Enter recipient public key'); return }
              try {
                const pk = new PublicKey(v)
                const ata = await getAssociatedTokenAddress(selectedMint!, pk, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
                const info = await connection.getAccountInfo(ata)
                if (info) {
                  pushLog('Recipient ATA exists: ' + ata.toBase58())
                } else {
                  // create
                  const ix = createAssociatedTokenAccountInstruction(wallet.publicKey!, ata, pk, selectedMint!, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
                  const tx = new Transaction().add(ix)
                  const sig = await wallet.sendTransaction(tx, connection)
                  await connection.confirmTransaction(sig, 'confirmed')
                  pushLog('Created recipient ATA: ' + ata.toBase58() + ' (' + sig + ')')
                }
              } catch (e: any) {
                pushLog('createRecipientAta failed: ' + (e.message || e.toString()))
              }
            }} disabled={!wallet.connected || !selectedMint}>Create/Get Recipient ATA</button>
          </div>

          <div style={{ marginBottom: 8 }}>
            <input placeholder="recipient pubkey" id="recipientPubkey2" style={{ width: 380, marginRight: 8 }} />
            <input type="number" placeholder="amount" id="transferAmount" style={{ width: 120, marginRight: 8 }} />
            <button onClick={async () => {
              try {
                const el = document.getElementById('recipientPubkey2') as HTMLInputElement
                const ael = document.getElementById('transferAmount') as HTMLInputElement
                const v = el.value.trim()
                const amt = Number(ael.value || '0')
                if (!v || !amt) { pushLog('Provide recipient and amount'); return }
                const recipientPk = new PublicKey(v)
                const recipientAta = await getAssociatedTokenAddress(selectedMint!, recipientPk, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)

                // Build raw TransferCheckedWithFee instruction
                const { TransactionInstruction } = require('@solana/web3.js')
                function u64ToBufferLE(n: number | bigint) {
                  const buf = Buffer.alloc(8)
                  buf.writeBigUInt64LE(BigInt(n))
                  return buf
                }
                const decimals = 6
                // fee param is ignored by program; Token program calculates based on config
                const data = Buffer.concat([
                  Buffer.from([26, 1]), // TokenInstruction.TransferFeeExtension (26), TransferCheckedWithFee (1)
                  u64ToBufferLE(amt),
                  Buffer.from([decimals]),
                  u64ToBufferLE(0),
                ])

                const payerAtaLocal = await getAssociatedTokenAddress(selectedMint!, wallet.publicKey!, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)

                const ix = new TransactionInstruction({
                  programId: TOKEN_2022_PROGRAM_ID,
                  keys: [
                    { pubkey: payerAtaLocal, isSigner: false, isWritable: true },
                    { pubkey: selectedMint!, isSigner: false, isWritable: false },
                    { pubkey: recipientAta, isSigner: false, isWritable: true },
                    { pubkey: wallet.publicKey!, isSigner: true, isWritable: false },
                  ],
                  data,
                })

                const tx = new Transaction().add(ix)
                const sig = await wallet.sendTransaction(tx, connection)
                await connection.confirmTransaction(sig, 'confirmed')
                pushLog('TransferWithFee succeeded: ' + sig)
              } catch (e: any) {
                pushLog('transferWithFee failed: ' + (e.message || e.toString()))
              }
            }} disabled={!wallet.connected || !selectedMint}>Transfer With Fee</button>
          </div>

          <div>
            <input placeholder="recipient pubkey" id="recipientPubkey3" style={{ width: 380, marginRight: 8 }} />
            <button onClick={async () => {
              try {
                const el = document.getElementById('recipientPubkey3') as HTMLInputElement
                const v = el.value.trim()
                if (!v) { pushLog('Enter recipient public key'); return }
                const pk = new PublicKey(v)
                const ata = await getAssociatedTokenAddress(selectedMint!, pk, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
                const acc = await getAccount(connection, ata, undefined, TOKEN_2022_PROGRAM_ID)
                const withheld = (acc as any).extensions?.transferFeeAmount?.withheldAmount || 0
                pushLog('Recipient ATA ' + ata.toBase58() + ' balance: ' + acc.amount.toString() + ' withheld: ' + withheld)
              } catch (e: any) {
                pushLog('inspectRecipient failed: ' + (e.message || e.toString()))
              }
            }} disabled={!wallet.connected || !selectedMint}>Inspect Recipient ATA</button>
          </div>

          <div style={{ marginTop: 8 }}>
            <h4>Withdraw withheld</h4>
            <div style={{ marginBottom: 8 }}>
              <input placeholder="destination ATA for withdrawn tokens" id="withdrawDest" style={{ width: 380, marginRight: 8 }} />
              <button onClick={async () => {
                try {
                  if (!selectedMint) { pushLog('No mint selected'); return }
                  const el = document.getElementById('withdrawDest') as HTMLInputElement
                  const v = el.value.trim()
                  if (!v) { pushLog('Enter destination ATA pubkey'); return }

                  // Call Token-2022's withdraw_withheld_tokens_from_mint directly
                  const dest = new PublicKey(v)
                  const payerAtaLocal = await getAssociatedTokenAddress(selectedMint!, wallet.publicKey!, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
                  const ix = withdrawWithheldTokensFromMint(selectedMint!, dest, wallet.publicKey!)
                  const tx = new Transaction().add(ix)
                  const sig = await wallet.sendTransaction(tx, connection)
                  await connection.confirmTransaction(sig, 'confirmed')
                  pushLog('withdrawWithheld succeeded: ' + sig)
                } catch (e: any) {
                  pushLog('withdrawWithheld failed: ' + (e.message || e.toString()))
                }
              }} disabled={!wallet.connected || !selectedMint}>Withdraw Withheld to ATA</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <h3>Logs</h3>
        <div style={{ maxHeight: 240, overflow: 'auto', background: '#f7f7f7', padding: 8 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
