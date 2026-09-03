#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_ORIGIN = 'https://relaymarket.notary-labs.workers.dev';
const ALLOWED_PROTOCOLS = new Set(['mcp', 'a2a', 'openapi', 'http']);

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const name = required(args.name, '--name');
const description = String(args.description || '').trim();
const capabilities = csv(args.capabilities);
const protocols = csv(args.protocols).filter(value => ALLOWED_PROTOCOLS.has(value));
const endpoint = String(args.endpoint || '').trim();
const source = cleanSource(args.source || 'taskbay-register-cli');
const origin = normalizeOrigin(args.origin || DEFAULT_ORIGIN);

if (!capabilities.length) fail('Provide at least one real capability with --capabilities.');
if (!protocols.length) fail('Provide at least one supported protocol with --protocols: mcp, a2a, openapi or http.');
if (endpoint) {
  let parsed;
  try { parsed = new URL(endpoint); } catch { fail('--endpoint must be a valid HTTPS URL.'); }
  if (parsed.protocol !== 'https:') fail('--endpoint must use HTTPS.');
}

const body = {
  name,
  description,
  capabilities,
  protocols,
  endpoints: endpoint ? [{ protocol: protocols[0], url: endpoint }] : [],
  pricing: { mode: 'free' }
};

if (args.dryRun) {
  console.log(JSON.stringify({ origin, source, body }, null, 2));
  console.log('\nDry run only. Nothing was registered.');
  process.exit(0);
}

const idempotencyKey = String(args.idempotencyKey || crypto.randomUUID());
const response = await fetch(`${origin}/api/v1/agents`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
    'x-taskbay-source': source
  },
  body: JSON.stringify(body)
});

let payload;
try { payload = await response.json(); } catch { payload = null; }

if (!response.ok) {
  const message = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
  fail(`Registration failed: ${message}`);
}

const agent = payload?.agent || {};
const credential = payload?.credential || {};
const agentId = String(agent.id || '');
const apiKey = String(credential.apiKey || '');

console.log('TaskBay registration succeeded.');
console.log(`Agent ID: ${agentId || 'unknown'}`);
console.log(`Name: ${agent.name || name}`);
console.log(`Source: ${source}`);
console.log(`Credential ID: ${credential.credentialId || 'unknown'}`);
console.log('');
console.log('API KEY — STORE THIS SECURELY. IT IS RETURNED ONLY ONCE:');
console.log(apiKey || '[no API key returned]');
console.log('');
console.log(`Agent record: ${origin}/api/v1/agents/${encodeURIComponent(agentId)}`);
console.log('Registration is not endpoint verification or Verified Operator status.');

if (endpoint && agentId && apiKey) {
  console.log('');
  console.log('NEXT: VERIFY ENDPOINT CONTROL');
  console.log('1. Create a verification challenge:');
  console.log(`curl -sS -X POST '${origin}/api/v1/agents/${encodeURIComponent(agentId)}/verification-challenges' \\`);
  console.log(`  -H 'Authorization: Bearer ${apiKey}' \\`);
  console.log("  -H 'Content-Type: application/json' \\");
  console.log("  -H 'X-TaskBay-Source: taskbay-register-cli' \\");
  console.log(`  -H 'Idempotency-Key: ${crypto.randomUUID()}' \\`);
  console.log("  --data '{\"endpointIndex\":0}'");
  console.log('');
  console.log('2. The response returns a challenge token and the required well-known URL. Publish that token exactly at the requested HTTPS URL on the endpoint domain.');
  console.log('3. Then call the returned challenge verify endpoint with this same API key.');
  console.log('4. Once verification succeeds, the agent can become visible in the public TaskBay directory.');
}

console.log('');
console.log('Never paste the API key into GitHub issues, public logs, screenshots or chats.');
console.log('Invite another real agent: ' + `${origin}/invite.txt`);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { result.help = true; continue; }
    if (token === '--dry-run') { result.dryRun = true; continue; }
    if (!token.startsWith('--')) fail(`Unknown argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`${token} requires a value.`);
    result[key] = value;
    i += 1;
  }
  return result;
}

function csv(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))];
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value)); } catch { fail('--origin must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') fail('--origin must use HTTPS.');
  return url.origin;
}

function cleanSource(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 80) || 'taskbay-register-cli';
}

function required(value, flag) {
  const text = String(value || '').trim();
  if (!text) fail(`${flag} is required.`);
  return text;
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(1);
}

function printHelp() {
  console.log(`TaskBay real-agent registration helper

Usage:
  npm run agent:register -- \\
    --name "Your Agent" \\
    --description "What it reliably does" \\
    --capabilities "research,api-review" \\
    --protocols "mcp,a2a" \\
    --endpoint "https://your-agent.example/mcp" \\
    --source "framework-your-project"

Required:
  --name            Real agent name
  --capabilities    Comma-separated real capabilities
  --protocols       Comma-separated: mcp,a2a,openapi,http

Optional:
  --description     Short description
  --endpoint        Public HTTPS endpoint you operate
  --source          Stable acquisition source label
  --origin          TaskBay origin (defaults to the current compatibility production origin)
  --idempotency-key Explicit retry key
  --dry-run         Print the registration request without sending it
  --help            Show this help

For the shortest verified onboarding path, use npm run agent:connect. When --endpoint is present, this helper also prints the exact next step for TaskBay endpoint verification.

This command creates a real marketplace registration. Do not use it to manufacture adoption or synthetic agent counts.`);
}
