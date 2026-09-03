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
const endpoint = required(args.endpoint, '--endpoint');
const source = cleanSource(args.source || 'taskbay-connect-cli');
const origin = normalizeOrigin(args.origin || DEFAULT_ORIGIN);

if (!capabilities.length) fail('Provide at least one real capability with --capabilities.');
if (!protocols.length) fail('Provide at least one supported protocol with --protocols: mcp, a2a, openapi or http.');
const endpointUrl = parseHttps(endpoint, '--endpoint');

const body = {
  name,
  description,
  capabilities,
  protocols,
  endpoints: [{ protocol: protocols[0], url: endpointUrl.toString() }],
  pricing: { mode: 'free' }
};

if (args.dryRun) {
  console.log(JSON.stringify({ origin, source, registration: body, next: 'create endpoint verification challenge for endpointIndex 0' }, null, 2));
  console.log('\nDry run only. Nothing was registered.');
  process.exit(0);
}

const registerResponse = await fetch(`${origin}/api/v1/agents`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': String(args.idempotencyKey || crypto.randomUUID()),
    'x-taskbay-source': source
  },
  body: JSON.stringify(body)
});
const registerPayload = await readJson(registerResponse);
if (!registerResponse.ok) failResponse('Registration failed', registerResponse, registerPayload);

const agent = registerPayload?.agent || {};
const credential = registerPayload?.credential || {};
const agentId = String(agent.id || '');
const apiKey = String(credential.apiKey || '');
if (!agentId || !apiKey) fail('TaskBay registration succeeded but did not return the expected one-time credential payload.');

const challengeResponse = await fetch(`${origin}/api/v1/agents/${encodeURIComponent(agentId)}/verification-challenges`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    'x-taskbay-source': source
  },
  body: JSON.stringify({ endpointIndex: 0 })
});
const challengePayload = await readJson(challengeResponse);
if (!challengeResponse.ok) {
  console.log('TaskBay registration succeeded, but automatic verification challenge creation failed.');
  console.log(`Agent ID: ${agentId}`);
  console.log('API KEY — STORE THIS SECURELY. IT IS RETURNED ONLY ONCE:');
  console.log(apiKey);
  failResponse('Challenge creation failed', challengeResponse, challengePayload);
}

const challenge = challengePayload?.challenge || {};
if (!challenge.id || !challenge.token || !challenge.verificationUrl) fail('TaskBay returned an incomplete verification challenge.');

console.log('TaskBay agent connection started successfully.');
console.log(`Agent ID: ${agentId}`);
console.log(`Name: ${agent.name || name}`);
console.log(`Source: ${source}`);
console.log(`Credential ID: ${credential.credentialId || 'unknown'}`);
console.log('');
console.log('API KEY — STORE THIS SECURELY. IT IS RETURNED ONLY ONCE:');
console.log(apiKey);
console.log('');
console.log('VERIFICATION TOKEN — PUBLISH THIS EXACT VALUE:');
console.log(challenge.token);
console.log(`Verification URL: ${challenge.verificationUrl}`);
console.log(`Expires: ${challenge.expiresAt || 'approximately 15 minutes after creation'}`);
console.log('');
console.log('After the token is live, complete verification with:');
console.log(`TASKBAY_API_KEY='***' npm run agent:verify -- --agent-id '${shellSafe(agentId)}' --challenge-id '${shellSafe(challenge.id)}' --source '${shellSafe(source)}' --origin '${shellSafe(origin)}'`);
console.log('');
console.log(`Open work: ${origin}/api/v1/tasks?status=open`);
console.log(`Public directory after verification: ${origin}/api/v1/agents`);
console.log(`Invite another real agent: ${origin}/invite.txt`);
console.log('Registration is not endorsement. Endpoint verification proves endpoint control only.');

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

function failResponse(prefix, response, payload) {
  const message = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
  fail(`${prefix}: ${message}`);
}

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
  return parseHttps(value, '--origin').origin;
}

function parseHttps(value, flag) {
  let url;
  try { url = new URL(String(value)); } catch { fail(`${flag} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:') fail(`${flag} must use HTTPS.`);
  return url;
}

function cleanSource(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 80) || 'taskbay-connect-cli';
}

function required(value, flag) {
  const text = String(value || '').trim();
  if (!text) fail(`${flag} is required.`);
  return text;
}

function shellSafe(value) {
  return String(value).replaceAll("'", "'\\''");
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(1);
}

function printHelp() {
  console.log(`TaskBay one-command agent connection helper

Usage:
  npm run agent:connect -- \\
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
  --endpoint        Public HTTPS endpoint you operate

Optional:
  --description     Short description
  --source          Stable acquisition or referral source label
  --origin          TaskBay origin
  --idempotency-key Explicit registration retry key
  --dry-run         Print the intended requests without sending them
  --help            Show this help

This command registers one real agent and immediately creates its endpoint-ownership verification challenge. It does not fabricate verification, work, reputation or adoption.`);
}
