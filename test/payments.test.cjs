'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair, Transaction, SystemInstruction } = require('@solana/web3.js');
const p = require('../src/payments.cjs');
const { mockRpc } = require('./rpc.cjs');

test('BIP39/SLIP-0010 matches independent implementation for multiple indexes', () => {
  const mnemonic = bip39.generateMnemonic(128);
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  for (const index of [0, 1, 7, 0x7fffffff]) {
    const { keypair, path } = p.deriveMnemonicAccount(mnemonic, index);
    const expected = Keypair.fromSeed(derivePath(path, seed.toString('hex')).key);
    assert.equal(keypair.publicKey.toBase58(), expected.publicKey.toBase58());
    keypair.secretKey.fill(0);
    expected.secretKey.fill(0);
  }
  seed.fill(0);
});

test('derivation rejects invalid mnemonic and account indexes', () => {
  assert.throws(() => p.deriveMnemonicAccount('invalid'));
  const mnemonic = bip39.generateMnemonic();
  for (const index of [-1, 1.5, 0x80000000, NaN, '0']) assert.throws(() => p.deriveMnemonicAccount(mnemonic, index));
});

test('public EVM recovery formula preserves bytes and normalization', () => {
  const key = randomBytes(32);
  const expected = Keypair.fromSeed(createHash('sha256').update(Buffer.concat([
    Buffer.from('VKX-SOL-DERIV-v1'), key
  ])).digest());
  const actual = p.deriveEvmPaymentAccount(` 0x${key.toString('hex').toUpperCase()} `);
  assert.equal(actual.publicKey.toBase58(), expected.publicKey.toBase58());
  assert.throws(() => p.deriveEvmPaymentAccount('bad'));
  key.fill(0); actual.secretKey.fill(0); expected.secretKey.fill(0);
});

test('amount conversion is exact and rejects unsafe inputs', () => {
  assert.equal(p.parseSol('0.000000001'), 1);
  assert.equal(p.parseSol('1.123456789'), 1123456789);
  assert.equal(p.formatSol(1123456789), '1.123456789');
  assert.equal(p.formatSol(0), '0');
  assert.equal(p.parseSol('9007199.254740991'), Number.MAX_SAFE_INTEGER);
  for (const value of ['0', '-1', '1e-9', '0.0000000001', '01', 'NaN', 1, '9007199.254740992']) assert.throws(() => p.parseSol(value));
  for (const value of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => p.formatSol(value));
});

test('balance query reads JSON-RPC value, including zero; errors never become zero', async () => {
  const address = Keypair.generate().publicKey.toBase58();
  const { connection, calls } = mockRpc();
  assert.deepEqual(await p.getSolBalance(connection, address), { lamports: 2000000000, sol: '2' });
  assert.equal(calls[0].params[0], address);
  const zero = mockRpc({ getBalance: { context: { slot: 1 }, value: 0 } });
  assert.equal((await p.getSolBalance(zero.connection, address)).sol, '0');
  const broken = mockRpc({ getBalance: () => { throw new Error('offline'); } });
  await assert.rejects(p.getSolBalance(broken.connection, address));
  await assert.rejects(p.getSolBalance(connection, 'invalid'));
});

function request() {
  const keypair = Keypair.generate();
  return { keypair, expectedSender: keypair.publicKey.toBase58(), to: Keypair.generate().publicKey.toBase58(), amount: '0.001' };
}

test('signed transfer decodes to System Program, correct sender, recipient and lamports', async () => {
  const input = request();
  const { connection, calls } = mockRpc();
  const result = await p.transferSol(connection, input);
  assert.equal(result.status, 'confirmed');
  const sends = calls.filter(c => c.method === 'sendTransaction');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].params[1].skipPreflight ?? false, false);
  assert.equal(sends[0].params[1].maxRetries, 0);
  const tx = Transaction.from(Buffer.from(sends[0].params[0], 'base64'));
  assert.equal(tx.verifySignatures(), true);
  assert.equal(tx.instructions.length, 1);
  assert.equal(tx.instructions[0].programId.toBase58(), '11111111111111111111111111111111');
  assert.equal(p.PROGRAM_ID, tx.instructions[0].programId.toBase58());
  const decoded = SystemInstruction.decodeTransfer(tx.instructions[0]);
  assert.equal(decoded.fromPubkey.toBase58(), input.expectedSender);
  assert.equal(decoded.toPubkey.toBase58(), input.to);
  assert.equal(decoded.lamports, 1000000n);
  input.keypair.secretKey.fill(0);
});

test('wrong sender, self-send, non-devnet, unknown fees and insufficient funds never broadcast', async () => {
  for (const kind of ['sender', 'self', 'cluster', 'fee', 'funds']) {
    const input = request();
    const overrides = {};
    if (kind === 'sender') input.expectedSender = input.to;
    if (kind === 'self') input.to = input.expectedSender;
    if (kind === 'cluster') overrides.getGenesisHash = 'mainnet';
    if (kind === 'fee') overrides.getFeeForMessage = { context: { slot: 1 }, value: null };
    if (kind === 'funds') overrides.getBalance = { context: { slot: 1 }, value: 1000000 };
    const { connection, calls } = mockRpc(overrides);
    await assert.rejects(p.transferSol(connection, input));
    assert.equal(calls.some(c => c.method === 'sendTransaction'), false, kind);
    input.keypair.secretKey.fill(0);
  }
});

test('broadcast ambiguity never retries; confirmation timeout preserves signature', async () => {
  const input = request();
  const broken = mockRpc({ sendTransaction: () => { throw new Error('transport lost'); } });
  await assert.rejects(p.transferSol(broken.connection, input), /outcome unknown/);
  assert.equal(broken.calls.filter(c => c.method === 'sendTransaction').length, 1);
  const pending = mockRpc();
  pending.connection.confirmTransaction = async () => { throw new Error('timeout'); };
  const result = await p.transferSol(pending.connection, input);
  assert.equal(result.status, 'unknown');
  assert.equal(typeof result.signature, 'string');
  input.keypair.secretKey.fill(0);
});

test('on-chain execution error is failed, never confirmed', async () => {
  const input = request();
  const { connection } = mockRpc();
  connection.confirmTransaction = async () => ({ value: { err: { InstructionError: [0, 'Custom'] } } });
  assert.equal((await p.transferSol(connection, input)).status, 'failed');
  input.keypair.secretKey.fill(0);
});
