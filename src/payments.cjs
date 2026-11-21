'use strict';

const { createHash, createHmac } = require('node:crypto');
const bip39 = require('bip39');
const { Keypair, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');

const PROGRAM_ID = SystemProgram.programId.toBase58();
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// Adapted from VKX Wallet's hardened ed25519 derivation; Node crypto replaces noble.
function deriveMnemonicAccount(mnemonic, accountIndex = 0) {
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid BIP39 mnemonic');
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex >= 0x80000000) {
    throw new Error('Invalid account index');
  }
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  let digest = createHmac('sha512', 'ed25519 seed').update(seed).digest();
  seed.fill(0);
  try {
    for (const index of [44, 501, accountIndex, 0]) {
      const data = Buffer.alloc(37);
      digest.copy(data, 1, 0, 32);
      data.writeUInt32BE(index + 0x80000000, 33);
      const next = createHmac('sha512', digest.subarray(32)).update(data).digest();
      data.fill(0);
      digest.fill(0);
      digest = next;
    }
    return { keypair: Keypair.fromSeed(digest.subarray(0, 32)), path };
  } finally {
    digest.fill(0);
  }
}

// This recovery formula is explicitly public in VKX Wallet. It is not BIP44.
function deriveEvmPaymentAccount(privateKeyHex) {
  const clean = String(privateKeyHex || '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('Invalid EVM private key encoding');
  const input = Buffer.from(clean, 'hex');
  const seed = createHash('sha256').update('VKX-SOL-DERIV-v1', 'utf8').update(input).digest();
  try {
    return Keypair.fromSeed(seed);
  } finally {
    input.fill(0);
    seed.fill(0);
  }
}

function parseSol(amount) {
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(amount)) {
    throw new Error('SOL amount must be a decimal string with at most 9 decimal places');
  }
  const [whole, fraction = ''] = amount.split('.');
  const lamports = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('SOL amount out of range');
  return Number(lamports);
}

function formatSol(lamports) {
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('Invalid lamport balance');
  const value = BigInt(lamports);
  const fraction = (value % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return (value / 1000000000n).toString() + (fraction ? `.${fraction}` : '');
}

async function getSolBalance(connection, address) {
  const lamports = await connection.getBalance(new PublicKey(address), 'confirmed');
  return { lamports, sol: formatSol(lamports) };
}

function buildSolTransfer({ from, to, amount, blockhash, lastValidBlockHeight }) {
  const sender = new PublicKey(from);
  const recipient = new PublicKey(to);
  if (sender.equals(recipient)) throw new Error('Sender and recipient must differ');
  return new Transaction({ feePayer: sender, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: parseSol(amount) })
  );
}

// Demo broadcast is restricted to devnet; never rebuild/retry an ambiguous send.
async function transferSol(connection, { keypair, expectedSender, to, amount }) {
  if (!keypair.publicKey.equals(new PublicKey(expectedSender))) throw new Error('Sender mismatch');
  parseSol(amount);
  new PublicKey(to);
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error('Broadcast allowed on devnet only');
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = buildSolTransfer({ from: expectedSender, to, amount, ...latest });
  const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
  if (!Number.isSafeInteger(fee.value) || fee.value < 0) throw new Error('Fee unavailable');
  const balance = await getSolBalance(connection, expectedSender);
  if (BigInt(balance.lamports) < BigInt(parseSol(amount)) + BigInt(fee.value)) throw new Error('Insufficient SOL including fee');
  transaction.sign(keypair);
  let signature;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 0 });
  } catch {
    throw new Error('Broadcast outcome unknown; do not resend automatically');
  }
  let confirmation;
  try {
    confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  } catch {
    return { signature, status: 'unknown' };
  }
  return { signature, status: confirmation.value.err ? 'failed' : 'confirmed' };
}

module.exports = { PROGRAM_ID, DEVNET_GENESIS, deriveMnemonicAccount, deriveEvmPaymentAccount,
  parseSol, formatSol, getSolBalance, buildSolTransfer, transferSol };
