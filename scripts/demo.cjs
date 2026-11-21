'use strict';

const bip39 = require('bip39');
const { Keypair, Transaction, SystemInstruction } = require('@solana/web3.js');
const { deriveMnemonicAccount, getSolBalance, transferSol, PROGRAM_ID } = require('../src/payments.cjs');
const { mockRpc } = require('../test/rpc.cjs');

async function main() {
  const { keypair, path } = deriveMnemonicAccount(bip39.generateMnemonic(128));
  try {
    const sender = keypair.publicKey.toBase58();
    const recipient = Keypair.generate().publicKey.toBase58();
    const { connection, calls } = mockRpc();
    const balance = await getSolBalance(connection, sender);
    const result = await transferSol(connection, { keypair, expectedSender: sender, to: recipient, amount: '0.001' });
    const wire = calls.find(c => c.method === 'sendTransaction').params[0];
    const tx = Transaction.from(Buffer.from(wire, 'base64'));
    const decoded = SystemInstruction.decodeTransfer(tx.instructions[0]);
    console.log(JSON.stringify({ mode: 'offline-mocked-rpc', networkAccess: false,
      onChainTransaction: false, path, sender, recipient, balance, programId: PROGRAM_ID,
      lamports: decoded.lamports.toString(), signatureVerifiedLocally: tx.verifySignatures(),
      simulatedStatus: result.status }, null, 2));
  } finally {
    keypair.secretKey.fill(0);
  }
}
main().catch(() => { console.error('Offline demo failed'); process.exitCode = 1; });
