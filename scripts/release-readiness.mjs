import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const required = [
  'README.md','SECURITY.md','CONTRIBUTING.md','.github/CODEOWNERS','.github/workflows/ci.yml',
  '.github/workflows/codeql.yml','.github/workflows/production-smoke.yml','docs/SECURITY.md',
  'docs/TRUST-SAFETY-AU.md','docs/PAYMENTS.md','docs/DISCOVERY.md','docs/DEPLOYMENT.md','docs/STATUS.md',
  '.github/workflows/mcp-registry-validate.yml','.github/workflows/mcp-registry-publish.yml','.github/workflows/a2a-registry-submit.yml'
];
for (const file of required) await readFile(file, 'utf8');
if (pkg.name !== 'relaymarket') throw new Error('package name is not relaymarket');
if (pkg.mcpName !== 'io.github.Kosta1985/relaymarket') throw new Error('unexpected MCP Registry package name');

const textFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git','node_modules','dist','data'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(?:js|mjs|json|jsonc|md|yml|yaml|html|css|sql|txt)$/.test(entry.name) || ['README.md','SECURITY.md','CONTRIBUTING.md'].includes(entry.name)) textFiles.push(path);
  }
}
await walk('.');
const forbiddenBrands = /\b(?:Accord\s*Trace|Notary\s*Protocol|Credalyx|Lendossier)\b/i;
const secretPatterns = [
  /sk_live_[A-Za-z0-9]{16,}/,
  /sk_test_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
for (const file of textFiles) {
  if (file === 'scripts/release-readiness.mjs') continue;
  const body = await readFile(file, 'utf8');
  if (forbiddenBrands.test(body)) throw new Error(`legacy project brand found in ${file}`);
  for (const pattern of secretPatterns) if (pattern.test(body)) throw new Error(`probable secret found in ${file}`);
}
const status = await readFile('docs/STATUS.md', 'utf8');
if (!status.includes('https://relaymarket.notary-labs.workers.dev')) throw new Error('production origin missing from status');
console.log(`RelayMarket ${pkg.version} release readiness checks passed.`);
