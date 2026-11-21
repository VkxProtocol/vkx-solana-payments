# Technical evidence and extraction report

Prepared on 2026-11-21. This report covers native SOL only.

## Source review and publication boundary

The reviewed VKX Wallet source uses the following integration primitives:

| Wallet source | Reviewed behavior | Standalone adaptation |
| --- | --- | --- |
| `src/services/wallet.ts`: `deriveEd25519Path`, mnemonic branch of `getSolanaKeypair` | BIP39 seed and hardened ed25519 path `m/44'/501'/i'/0'` | Same derivation with Node HMAC-SHA512; no storage, PIN or mobile dependencies. |
| `src/services/wallet.ts`: `deriveSolanaSeedFromEvmKey` | Publicly documented tagged SHA-256 recovery formula | Same bytes and tag; no EVM wallet loader or persisted key. |
| `src/services/networks/solana.ts`: `getSolanaBalance` | RPC `getBalance`, lamport extraction and SOL conversion | Direct web3.js connection; exact decimal output, errors propagate. |
| `src/services/wallet.ts`: SOL branch of `sendNative` | Validate sender, convert nine decimals, build `SystemProgram.transfer`, sign and broadcast | Same native transfer instruction; devnet restriction, explicit fee check and single broadcast. |

The public recovery formula is explicitly described as public in the original source. Reused logic is limited to client-side cryptography and standard Solana SDK calls. No complete wallet service, backend implementation, provider pool, internal endpoint, production configuration, credentials, real account data or wallet storage is included. This is an adapted standalone implementation, not a byte-for-byte copy of the full wallet and not proof of every wallet feature.

The wallet's priority-fee transport may add Compute Budget instructions (`ComputeBudget111111111111111111111111111111`). Those policies, retry/failover logic, SPL token transfers, swaps, fee splitting, sponsorship, Pix and payment services are excluded. In this module, each transfer contains exactly one System Program instruction.

## Program identity

Native SOL transfers invoke **`11111111111111111111111111111111` (System Program)**. The tests decode the serialized instruction and assert that literal ID. A read-only public devnet query independently observed the account as executable, owned by `NativeLoader1111111111111111111111111111111`. There is no custom VKX deployment in this extracted native-transfer flow. Do not submit this ID as a program developed or deployed by VKX.

References: [official System Program documentation](https://solana.com/docs/core/programs/builtin-programs), [official terminology](https://solana.com/docs/references/terminology).

## Executed validation

| Check | Result | Evidence |
| --- | --- | --- |
| Clean dependency installation | `npm ci --ignore-scripts` succeeded using the generated public-registry lockfile and local package cache. Dependencies resolve inside this module. | `package-lock.json`; reproducible with README commands. |
| Unit/integration tests | 9/9 passed on Node.js 22.23.4. Actual web3.js JSON-RPC serialization intercepted in memory; confirmation separately mocked. | `evidence/tests.txt` |
| Original source parity | 14 checks passed: 9 mnemonic/index address comparisons, 3 EVM-derived address comparisons, default path and native-transfer source assertions. Original functions were extracted and transpiled locally; only public addresses were compared. | `evidence/parity.json` |
| Independent derivation reference | Compared against `ed25519-hd-key` for indexes 0, 1, 7 and the largest hardened index. Random inputs remain in memory. | Public test suite |
| Offline demonstration | Derived account, simulated balance, signed serialized transfer, verified signature locally, decoded transfer amount and program ID. | `evidence/demo.json` |
| Devnet read-only check | Genesis, executable System Program account and actual balance queried through public RPC. No airdrop or broadcast. | `evidence/devnet.json` |
| Publication verification | Exact 16-file allowlist, secret/phrase/internal-URL patterns, unexpected-file and symlink checks; SHA-256 hashes printed. Manual review supplements the scanner. | Run `npm run verify:public`. |

The private-source parity audit is an extraction-time observation, not independently reproducible without the private wallet source. The public independent-reference tests are reproducible. No seeds, mnemonics or private keys are persisted as test vectors. The offline evidence contains disposable public addresses only and changes on rerun.

Existing wallet checks `npm run test:wallet-core` and `npm run test:solana-priority` also reported success before extraction. Their raw logs are not public artifacts because they cover unrelated wallet functionality. Existing wallet source and dependency files were not edited.

## Limits

- No SOL transfer was broadcast to devnet or mainnet during preparation; there is no transaction ID or explorer receipt proving live settlement.
- The actual balance evidence is for the public System Program account, not a funded payment wallet. Test payment balances are simulated.
- No mobile UI, device, websocket confirmation transport, production failover or independent security audit was performed for this standalone module.
- An RPC-reported confirmation is only as trustworthy as that RPC; `unknown` must not be treated as success or retried automatically.
- First test attempts exposed dependency resolution from the parent before installation and a web3.js option that omits explicit `false`. The final evidence was regenerated after isolated installation and correction. The initial live check also exposed an incomplete genesis constant, corrected against the public RPC before the passing check.
- No production changes, builds, OTA, VPS operations or live transfers were performed. Publication is restricted to the standalone files listed below, under the repository owner's explicit authorization.

## Safe publication manifest

Publish exactly these paths from this standalone folder as the repository root:

```text
.gitignore
LICENSE
README.md
REPORT.md
package.json
package-lock.json
src/payments.cjs
test/payments.test.cjs
test/rpc.cjs
scripts/demo.cjs
scripts/check-devnet.cjs
scripts/verify-public.cjs
evidence/tests.txt
evidence/demo.json
evidence/devnet.json
evidence/parity.json
```

Exclude the parent repository, its history, local audit scripts, Obsidian notes, caches and `node_modules`. The chosen MIT license covers only this standalone module; runtime dependencies are MIT (`@solana/web3.js`) and ISC (`bip39`), with their own notices distributed in their packages.

Submission repository: **https://github.com/VkxProtocol/vkx-solana-payments**. Only the standalone files in this manifest are approved for publication; private wallet source and history remain excluded.
