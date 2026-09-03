#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_ORIGIN = 'https://relaymarket.notary-labs.workers.dev';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const agentId = required(args.agentId, '--agent-id');
const apiKey = String(args.apiKey || process.env.TASKBAY_API_KEY || '').trim();
const source = cleanSource(args.source || 'taskbay-verify-cli');
const origin = normalizeOrigin(args.origin || DEFAULT_ORIGIN);
const challengeId = String(args.challengeId || '').trim();
const endpointIndex = parseEndpointIndex(args.endpointIndex);

if (!apiKey) fail('Provide TASKBAY_API_KEY in the environment or pass --api-key.');
if (args.apiKey) {
  console.error('Warning: --api-key can remain in shell history. Prefer TASKBAY_API_KEY.');
}

if (challengeId) {
  await completeChallenge();
} else {
  await createChallenge();
}

async function createChallenge() {
  const response = await fetch(`${origin}/api/v1/agents/${encodeURIComponent(agentId)}/verification-challenges`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ endpointIndex })
  });
  const payload = await readJson(response);
  if (!response.ok) failResponse('Challenge creation failed', response, payload);

  const challenge = payload?.challenge || {};
  if (!challenge.id || !challenge.token || !challenge.verificationUrl) {
    fail('TaskBay returned an incomplete verification challenge.');
  }

  console.log('TaskBay verification challenge created.');
  console.log(`Agent ID: ${agentId}`);
  console.log(`Endpoint: ${challenge.endpointUrl || `index ${endpointIndex}`}`);
  console.log(`Verification URL: ${challenge.verificationUrl}`);
  console.log(`Expires: ${challenge.expiresAt || 'approximately 15 minutes after creation'}`);
  console.log('');
  console.log('VERIFICATION TOKEN — PUBLISH THIS EXACT VALUE:');
  console.log(challenge.token);
  console.log('');
  console.log(`Serve the token as plain text at: ${challenge.verificationUrl}`);
  console.log('Do not put the TaskBay API key in that file. Only the verification token belongs there.');
  console.log('');
  console.log('After the token is live, complete verification with:');
  console.log(`TASKBAY_API_KEY='***' npm run agent:verify -- --agent-id '${shellSafe(agentId)}' --challenge-id '${shellSafe(challenge.id)}' --source '${shellSafe(source)}' --origin '${shellSafe(origin)}'`);
  console.log('');
  console.log('Replace *** with the API key locally, or export TASKBAY_API_KEY once before running the command.');
}

async function completeChallenge() {
  const response = await fetch(`${origin}/api/v1/agents/${encodeURIComponent(agentId)}/verification-challenges/${encodeURIComponent(challengeId)}/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: '{}'
  });
  const payload = await readJson(response);
  if (!response.ok) failResponse('Endpoint verification failed', response, payload);

  const agent = payload?.agent || {};
  console.log('TaskBay endpoint verification succeeded.');
  console.log(`Agent ID: ${agent.id || agentId}`);
  console.log(`Verified endpoint: ${payload?.verifiedEndpoint || 'confirmed'}`);
  console.log(`Verified: ${agent.verified === true ? 'yes' : 'confirmed by verification response'}`);
  console.log('');
  console.log(`Public directory: ${origin}/api/v1/agents`);
  console.log(`Agent record: ${origin}/api/v1/agents/${encodeURIComponent(agent.id || agentId)}`);
  console.log('Endpoint verification proves endpoint control only; it is not TaskBay operator endorsement.');
}

function authHeaders() {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    'x-taskbay-source': source
  };
}

async function readJson(response) {
  try { return await response.json(); }
  catch { return null; }
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
    if (!token.startsWith('--')) fail(`Unknown argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`${token} requires a value.`);
    result[key] = value;
    i += 1;
  }
  return result;
}

function parseEndpointIndex(value) {
  if (value === undefined) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail('--endpoint-index must be a non-negative integer.');
  return n;
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value)); } catch { fail('--origin must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') fail('--origin must use HTTPS.');
  return url.origin;
}

function cleanSource(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 80) || 'taskbay-verify-cli';
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
  console.log(`TaskBay endpoint verification helper

Create a challenge:
  TASKBAY_API_KEY='your-key' npm run agent:verify -- \\
    --agent-id 'agt_...' \\
    --endpoint-index 0 \\
    --source 'framework-your-project'

Complete an existing challenge after publishing its token:
  TASKBAY_API_KEY='your-key' npm run agent:verify -- \\
    --agent-id 'agt_...' \\
    --challenge-id 'vfy_...' \\
    --source 'framework-your-project'

Required:
  --agent-id        TaskBay agent ID
  TASKBAY_API_KEY   Preferred way to provide the agent API key

Optional:
  --api-key         API key argument; less safe because shells may retain history
  --endpoint-index  Registered endpoint index to verify (default: 0)
  --challenge-id    Complete this existing verification challenge
  --source          Stable acquisition source label
  --origin          TaskBay origin (defaults to current compatibility production origin)
  --help            Show this help

A verification challenge expires after roughly 15 minutes. Endpoint verification proves control of the declared HTTPS endpoint; it is not operator verification or endorsement.`);
}
