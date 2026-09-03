import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const required = [
  'README.md','SECURITY.md','CONTRIBUTING.md','.github/CODEOWNERS','.github/workflows/ci.yml',
  '.github/workflows/codeql.yml','.github/workflows/production-smoke.yml','docs/SECURITY.md',
  'docs/TRUST-SAFETY-AU.md','docs/PAYMENTS.md','docs/DISCOVERY.md','docs/DEPLOYMENT.md','docs/STATUS.md',
  'docs/BRAND-MIGRATION.md','public/robots.txt','public/sitemap.xml','public/llms.txt','public/llms-full.txt',
  'public/invite.txt','public/frameworks.txt','public/join.html','public/.well-known/taskbay.json',
  '.github/workflows/mcp-registry-validate.yml','.github/workflows/mcp-registry-publish.yml','.github/workflows/a2a-registry-submit.yml'
];
for (const file of required) await readFile(file, 'utf8');

if (pkg.name !== 'taskbay') throw new Error('package name is not taskbay');
if (pkg.mcpName !== 'io.github.Kosta1985/relaymarket') throw new Error('unexpected MCP Registry compatibility name');

const redeploy = await readFile('scripts/redeploy-production.sh', 'utf8');
if (!redeploy.includes('"name": "taskbay"')) throw new Error('production deploy guard is not TaskBay-aware');
if (!redeploy.includes('https://relaymarket.notary-labs.workers.dev')) throw new Error('production compatibility origin missing from deploy script');
if (!redeploy.includes('d1 migrations list relaymarket --remote')) throw new Error('production D1 compatibility target changed unexpectedly');

const buildPublic = await readFile('scripts/build-public.mjs', 'utf8');
for (const discoveryFile of ['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', '.well-known/taskbay.json', 'agents.txt', 'invite.txt', 'frameworks.txt', 'join.html']) {
  if (!buildPublic.includes(discoveryFile)) throw new Error(`public build does not process ${discoveryFile}`);
}

const invite = await readFile('public/invite.txt', 'utf8');
if (!invite.includes('agent-invite')) throw new Error('agent invite source attribution is missing');
if (!invite.includes('__PUBLIC_ORIGIN__/join.html?source=agent-invite')) throw new Error('agent invite does not point to the attributed join page');

const frameworks = await readFile('public/frameworks.txt', 'utf8');
for (const source of ['framework-openai-agents','framework-langgraph','framework-crewai','framework-google-adk','framework-microsoft-agent','mcp-registry','a2a-registry','github']) {
  if (!frameworks.includes(`source=${source}`)) throw new Error(`framework acquisition route missing ${source}`);
}

const joinHtml = await readFile('public/join.html', 'utf8');
if (!joinHtml.includes('?source=agent-invite')) throw new Error('join page does not preserve agent-invite attribution');
if (!joinHtml.includes('TaskBay')) throw new Error('join page is not TaskBay branded');

const manifest = JSON.parse(await readFile('public/.well-known/taskbay.json', 'utf8'));
if (!String(manifest.entrypoints?.agentJoin || '').includes('source=agent-invite')) throw new Error('TaskBay manifest is missing attributed agent join entrypoint');
if (!String(manifest.entrypoints?.agentInvite || '').endsWith('/invite.txt')) throw new Error('TaskBay manifest is missing machine invite entrypoint');

const textFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git','node_modules','dist','data'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(?:js|mjs|json|jsonc|md|yml|yaml|html|css|sql|txt|xml)$/.test(entry.name) || ['README.md','SECURITY.md','CONTRIBUTING.md'].includes(entry.name)) textFiles.push(path);
  }
}
await walk('.');
const forbiddenBrands = /\b(?:Notary\s*Protocol|Credalyx|Lendossier)\b/i;
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
  if (forbiddenBrands.test(body)) throw new Error(`unrelated project brand found in ${file}`);
  for (const pattern of secretPatterns) if (pattern.test(body)) throw new Error(`probable secret found in ${file}`);
}
const status = await readFile('docs/STATUS.md', 'utf8');
if (!status.includes('https://relaymarket.notary-labs.workers.dev')) throw new Error('production compatibility origin missing from status');
console.log(`TaskBay ${pkg.version} release readiness checks passed with RelayMarket compatibility identities preserved.`);
