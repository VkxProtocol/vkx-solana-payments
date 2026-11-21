'use strict';

const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const { DEVNET_GENESIS } = require('../src/payments.cjs');

// Real web3.js JSON-RPC serialization, intercepted in memory. No sockets.
function mockRpc(overrides = {}) {
  const calls = [];
  const blockhash = Keypair.generate().publicKey.toBase58();
  const defaults = {
    getGenesisHash: DEVNET_GENESIS,
    getBalance: { context: { slot: 1 }, value: 2000000000 },
    getLatestBlockhash: { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 100 } },
    getFeeForMessage: { context: { slot: 1 }, value: 5000 },
    sendTransaction(params) {
      const transaction = Transaction.from(Buffer.from(params[0], 'base64'));
      if (!transaction.verifySignatures()) throw new Error('Invalid transaction signature');
      return require('bs58').encode(transaction.signature);
    }
  };
  const connection = new Connection('https://api.devnet.solana.com', {
    commitment: 'confirmed',
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request);
      const handler = Object.hasOwn(overrides, request.method) ? overrides[request.method] : defaults[request.method];
      if (handler === undefined) throw new Error(`Unexpected RPC: ${request.method}`);
      const result = typeof handler === 'function' ? handler(request.params) : handler;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  // Avoid web3.js websocket polling; confirmation outcomes are independently injected.
  connection.confirmTransaction = async () => ({ context: { slot: 2 }, value: { err: null } });
  return { connection, calls };
}

module.exports = { mockRpc };
