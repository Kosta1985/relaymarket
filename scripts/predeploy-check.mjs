import { readFile, access } from 'node:fs/promises';

const config = await readFile('wrangler.jsonc', 'utf8');
const wrangler = JSON.parse(config);
if (config.includes('REPLACE_WITH_D1_DATABASE_ID')) throw new Error('Create the production TaskBay D1 database and replace REPLACE_WITH_D1_DATABASE_ID before deployment.');
const paymentProvider = String(wrangler.vars?.PAYMENT_PROVIDER || 'disabled');
const processorPolicy = String(wrangler.vars?.PAYMENT_PROCESSOR_COST_POLICY || 'unset');
if (paymentProvider === 'stripe' && !['platform_absorbs','provider_external_costs','payer_surcharge_compliant'].includes(processorPolicy)) throw new Error('Choose and document PAYMENT_PROCESSOR_COST_POLICY before enabling Stripe.');
const origin = String(process.env.PUBLIC_ORIGIN || '').trim();
if (!origin) throw new Error('PUBLIC_ORIGIN is required for deployment.');
const parsed = new URL(origin);
if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be a bare HTTPS origin.');
await access('dist/index.html');
const html = await readFile('dist/index.html', 'utf8');
if (/__PUBLIC_ORIGIN__|__GOOGLE_SITE_VERIFICATION__/.test(html)) throw new Error('Deployment placeholders remain in dist/index.html.');
if (!html.includes(`rel="canonical" href="${parsed.origin}/"`)) throw new Error('Built canonical URL does not match PUBLIC_ORIGIN.');

await access('dist/.well-known/mcp.json');
const mcpRaw = await readFile('dist/.well-known/mcp.json', 'utf8');
if (/__PUBLIC_ORIGIN__|__TASKBAY_VERSION__|__RELAYMARKET_VERSION__/.test(mcpRaw)) throw new Error('Deployment placeholders remain in dist/.well-known/mcp.json.');
const mcp = JSON.parse(mcpRaw);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (mcp.name !== 'TaskBay') throw new Error(`Built MCP discovery name must be TaskBay, got ${mcp.name}.`);
if (mcp.version !== pkg.version) throw new Error(`Built MCP discovery version ${mcp.version} does not match package ${pkg.version}.`);
if (mcp.endpoint !== `${parsed.origin}/mcp`) throw new Error('Built MCP discovery endpoint does not match PUBLIC_ORIGIN.');
if (mcp.officialRegistryName !== 'io.github.Kosta1985/relaymarket') throw new Error('Built MCP discovery registry identity mismatch; the historical registry ID remains a compatibility identifier until separately migrated.');
if (mcp.paymentsEnabled !== false) throw new Error('Current release must advertise paymentsEnabled=false.');

console.log('TaskBay deployment preflight passed.');