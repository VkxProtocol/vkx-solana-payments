# vkx-solana-payments

Standalone native SOL payment integration adapted from VKX Wallet for the Dev3pack Solana Hackathon. Runs with Node.js 22 or later, without the mobile app or its backend.

## Run

From this repository's root:

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run verify:public
```

The demo runs entirely offline: it generates a disposable mnemonic in memory, derives a Solana account, reads a simulated balance, signs a native SOL transfer and verifies the serialized signature and instruction. It never prints or saves recovery words, seeds or private keys. Addresses change each run. The mocked balance and confirmation are not blockchain evidence.

Optional public devnet inspection (read only, no wallet required):

```sh
npm run check:devnet
```

This queries the devnet genesis hash, System Program executable account and its SOL balance. It never requests an airdrop, signs or broadcasts. RPC unavailability is reported as UNVERIFIED with a nonzero exit code.

## Integration

`require('./src/payments.cjs')` exports:

| Function | Behavior |
| --- | --- |
| `deriveMnemonicAccount(mnemonic, accountIndex = 0)` | BIP39 with empty passphrase, hardened SLIP-0010 ed25519 path `m/44'/501'/i'/0'`; returns `{ keypair, path }`. |
| `deriveEvmPaymentAccount(privateKeyHex)` | VKX-specific recovery: SHA-256 of UTF-8 `VKX-SOL-DERIV-v1` followed by the decoded 32-byte EVM key, then `Keypair.fromSeed`. |
| `getSolBalance(connection, address)` | Confirmed SOL balance as `{ lamports, sol }`; errors propagate. |
| `buildSolTransfer({ from, to, amount, blockhash, lastValidBlockHeight })` | Unsigned legacy System Program transfer; `amount` is an exact decimal SOL string. |
| `transferSol(connection, { keypair, expectedSender, to, amount })` | Verifies sender and devnet genesis, estimates fee, checks balance, signs, sends once with preflight, and checks confirmation. |
| `parseSol(amount)`, `formatSol(lamports)` | Exact conversion with nine decimal places and safe integer limits. |

Supply a web3.js `Connection` and a keypair held only in memory. The offline demo shows the complete invocation. Do not paste real secrets into code, shell arguments, environment files, logs or issues. No command in this project accepts secret material from the command line. JavaScript strings cannot be reliably erased; zeroing buffers is only best effort.

The EVM-derived account is specific to VKX and does not appear by importing the same EVM key into another wallet. The module does not migrate accounts, select legacy paths, implement PIN storage or replicate the app's multi-account discovery. BIP39 derives the explicit path only.

Broadcast is deliberately devnet-only in this standalone demo. A trusted RPC is required: a remote server's reported genesis hash is not independent proof of network identity. No live transfer was performed during preparation. If send fails ambiguously, the module does not retry. If confirmation fails, it returns the signature with `status: 'unknown'`; inspect that signature before attempting another payment. `failed` means the RPC returned an execution error. Only a successful confirmation produces `confirmed`.

## Program ID

**`11111111111111111111111111111111` — Solana System Program.**

This is the actual program invoked for the native SOL transfer extracted from the wallet, not a custom VKX deployment. Derivation is local cryptography; balance queries use JSON-RPC and do not invoke a custom program. The production wallet can add Compute Budget instructions for priority fees; this minimal transfer has only the System Program instruction. SPL tokens, swaps, fee collection, sponsorship and backend payment orchestration are outside this module's scope.

Official references: [System Program](https://solana.com/docs/core/programs/builtin-programs), [Solana terminology](https://solana.com/docs/references/terminology), [getBalance RPC](https://solana.com/docs/rpc/http/getbalance), [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md), [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki).

## Verifiable evidence and publication

See [REPORT.md](REPORT.md) and `evidence/` for test results, offline demo, source parity and the read-only devnet observation. Tests use random ephemeral inputs and an independent SLIP-0010 implementation, decode actual signed wire bytes and exercise RPC and confirmation failures. Confirmation transport is mocked separately; the test suite does not validate websocket behavior or settlement on a live cluster.

`npm run verify:public` checks the exact 16-file publication allowlist, looks for embedded secret patterns, BIP39 phrases and internal URLs, and prints SHA-256 hashes for review. Pattern checks supplement manual review; they are not a general guarantee that arbitrary new files are safe. Publish only the listed files from this folder, never the parent wallet repository or its Git history. Do not include `node_modules` or local audit scripts. There is no deployment, OTA or GitHub publication automation.

After publishing, use **https://github.com/VkxProtocol/vkx-solana-payments** as the submission's source repository link. This project provides an integration demo, not a newly deployed on-chain program. If a form requires a custom deployed Program ID, do not claim the System Program is owned or deployed by VKX.

MIT license applies only to this standalone module. Dependencies retain their own licenses. `private: true` prevents accidental npm publication; it does not prevent a public GitHub repository.
