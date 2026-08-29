import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'wrangler.jsonc';
const DB_NAME = 'relaymarket';
const PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? ['ignore','pipe','pipe'] : 'inherit', encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    if (opts.capture) process.stderr.write(r.stderr || '');
    process.exit(r.status ?? 1);
  }
  return opts.capture ? (r.stdout || '') : '';
}

function npxWrangler(args, capture = false) {
  return run('npx', ['--yes', 'wrangler@4.127.1', ...args], { capture });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.name !== 'relaymarket') throw new Error('Refusing to run outside RelayMarket.');
let cfg = readFileSync(CONFIG, 'utf8');
if (!cfg.includes('"name": "relaymarket"')) throw new Error('wrangler config is not RelayMarket.');

console.log('\n[1/7] Checking Cloudflare authentication...');
const who = spawnSync('npx', ['--yes','wrangler@4.127.1','whoami'], { encoding:'utf8', timeout: 60000 });
if (who.status !== 0 || /not authenticated|login/i.test((who.stdout||'') + (who.stderr||''))) {
  console.error('\nCloudflare is not authenticated in this environment.');
  console.error('Run: npx wrangler@4.127.1 login');
  console.error('Then rerun: npm run cf:bootstrap');
  process.exit(2);
}
process.stdout.write(who.stdout || '');

console.log('\n[2/7] Checking RelayMarket D1 binding...');
if (cfg.includes(PLACEHOLDER)) {
  console.log('Creating a NEW D1 database named relaymarket...');
  const out = npxWrangler(['d1','create',DB_NAME], true);
  process.stdout.write(out);
  const match = out.match(/database_id\s*=\s*["']([0-9a-f-]{20,})["']/i)
    || out.match(/"database_id"\s*:\s*"([0-9a-f-]{20,})"/i)
    || out.match(/database_id[^0-9a-f]+([0-9a-f-]{20,})/i);
  if (!match) throw new Error('Created D1 but could not safely parse database_id. Refusing to edit config automatically.');
  cfg = cfg.replace(PLACEHOLDER, match[1]);
  writeFileSync(CONFIG, cfg);
  console.log(`Configured new RelayMarket D1: ${match[1]}`);
} else {
  console.log('D1 ID already configured; refusing to create a second database automatically.');
}

console.log('\n[3/7] Applying local migrations...');
npxWrangler(['d1','migrations','apply',DB_NAME,'--local']);

console.log('\n[4/7] Running tests...');
run('npm',['test']);

console.log('\n[5/7] Running full smoke test...');
run('npm',['run','smoke']);

console.log('\n[6/7] Applying remote migrations to the NEW RelayMarket D1...');
npxWrangler(['d1','migrations','apply',DB_NAME,'--remote']);

console.log('\n[7/7] Infrastructure bootstrap complete.');
console.log('Payments remain disabled. No Stripe secrets were changed.');
console.log('Next: determine the real RelayMarket HTTPS origin, build with PUBLIC_ORIGIN, run deploy:check, then deploy and postdeploy:check.');
