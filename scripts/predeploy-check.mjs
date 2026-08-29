import { readFile, access } from 'node:fs/promises';

const config = await readFile('wrangler.jsonc', 'utf8');
const wrangler = JSON.parse(config);
if (config.includes('REPLACE_WITH_D1_DATABASE_ID')) throw new Error('Create a NEW RelayMarket D1 database and replace REPLACE_WITH_D1_DATABASE_ID before deployment.');
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
console.log('RelayMarket deployment preflight passed.');
