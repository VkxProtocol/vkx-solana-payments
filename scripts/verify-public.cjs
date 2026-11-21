'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A bounded allowlist is the publication boundary. node_modules is never published.
const files = [
  '.gitignore', 'package.json', 'package-lock.json', 'README.md', 'REPORT.md', 'LICENSE',
  'src/payments.cjs', 'test/payments.test.cjs', 'test/rpc.cjs',
  'scripts/demo.cjs', 'scripts/check-devnet.cjs', 'scripts/verify-public.cjs',
  'evidence/tests.txt', 'evidence/demo.json', 'evidence/devnet.json', 'evidence/parity.json'
];
const root = path.resolve(__dirname, '..');
const failures = [];
const hashes = [];
const rules = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:0x)?[a-fA-F0-9]{64}/, // No embedded keys/seeds or tx hashes are needed here.
  /(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["'][^"']+["']/i,
  /(?:C:\\Users\\|\/srv\/apps\/|hostgator|x-internal-key)/i
];
const bip39 = require('bip39');
for (const name of files) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) { failures.push(`${name}: missing`); continue; }
  const data = fs.readFileSync(file);
  const content = data.toString('utf8');
  // The scanner source contains its own detection rules; do not scan those as data.
  if (name !== 'scripts/verify-public.cjs') {
    for (const rule of rules) if (rule.test(content)) failures.push(`${name}: sensitive-pattern match`);
    for (const match of content.matchAll(/https?:\/\/[^\s"'`<>]+/g)) {
      const url = new URL(match[0]);
      const host = url.hostname.toLowerCase();
      if (url.username || url.password ||
          /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
          host === 'vkxtech.com.br' || host.endsWith('.vkxtech.com.br') || host.endsWith('.internal')) {
        failures.push(`${name}: private endpoint or URL credentials`);
      }
    }
    const words = content.match(/\b[a-z]+\b/g) || [];
    for (const size of [12, 15, 18, 21, 24]) {
      for (let i = 0; i <= words.length - size; i++) {
        if (bip39.validateMnemonic(words.slice(i, i + size).join(' '))) {
          failures.push(`${name}: BIP39 phrase detected`); break;
        }
      }
    }
  }
  hashes.push({ file: name, sha256: crypto.createHash('sha256').update(data).digest('hex') });
}
function inspect(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) failures.push(`${name}: symlink not allowed`);
    else if (entry.isDirectory()) inspect(path.join(directory, entry.name), `${name}/`);
    else if (!files.includes(name)) failures.push(`${name}: outside publication allowlist`);
  }
}
inspect(root);
console.log(JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', files: hashes, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
