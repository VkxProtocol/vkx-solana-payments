'use strict';

const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const { PROGRAM_ID, DEVNET_GENESIS, getSolBalance } = require('../src/payments.cjs');

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), {
    commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(12000) })
  });
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error('Unexpected cluster');
  const program = await connection.getAccountInfo(new PublicKey(PROGRAM_ID), 'confirmed');
  if (!program?.executable) throw new Error('System Program is not executable');
  const balance = await getSolBalance(connection, PROGRAM_ID);
  console.log(JSON.stringify({ mode: 'devnet-read-only', observedAt: new Date().toISOString(),
    network: 'devnet', genesis, programId: PROGRAM_ID, executable: program.executable,
    owner: program.owner.toBase58(), balance, transactionSent: false }, null, 2));
}
main().catch(() => {
  console.log(JSON.stringify({ mode: 'devnet-read-only', status: 'UNVERIFIED',
    reason: 'Public RPC unavailable or validation failed; no transaction sent', transactionSent: false }, null, 2));
  process.exitCode = 1;
});
