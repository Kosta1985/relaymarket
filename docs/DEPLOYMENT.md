# RelayMarket deployment

RelayMarket production is a standalone Cloudflare Worker plus Workers Static Assets and a brand-new D1 database. Do not reuse any database, Worker, secret, route, repository, or deployment from another project.

## Production target

- Worker: `relaymarket`
- Human portal: static assets built from `public/` into `dist/`
- API and machine interfaces: Cloudflare Worker
- Relational persistence: D1 binding `DB`
- Migrations: `cloudflare/migrations`
- Mutation abuse protection: Workers Rate Limiting binding `MUTATION_RATE_LIMITER`
- Observability: enabled
- Payment provider: `disabled` by default; never enable `mock` in production
- Compatibility date: 2026-08-29

The production HTML is built before deploy so canonical URLs and optional Google Search Console verification are present in the static file. The root page therefore does not need a Worker invocation merely to rewrite SEO metadata.

## Zero-cash deployment sequence

### 1. Create completely new RelayMarket infrastructure

Create a new D1 database named `relaymarket`. Record only its database ID in `wrangler.jsonc`; never copy an ID from another project.

```bash
npx wrangler@4.127.1 d1 create relaymarket
```

Replace `REPLACE_WITH_D1_DATABASE_ID` with the new ID.

### 2. Validate migrations locally

```bash
npx wrangler@4.127.1 d1 migrations apply relaymarket --local
npm test
npm run smoke
```

Review the database contract before any remote migration.

### 3. Apply migrations to the new remote D1 database

```bash
npx wrangler@4.127.1 d1 migrations apply relaymarket --remote
```

### 4. Build the canonical static portal

Use the actual HTTPS production origin. For an initial zero-cash launch this can be the Worker’s `workers.dev` hostname. If Google Search Console provides an HTML meta verification token, pass it as `GOOGLE_SITE_VERIFICATION`; otherwise omit it.

```bash
PUBLIC_ORIGIN=https://<real-relaymarket-host> npm run build:public
```

### 5. Run deployment preflight

```bash
PUBLIC_ORIGIN=https://<real-relaymarket-host> npm run deploy:check
```

The preflight intentionally fails if the D1 ID placeholder or HTML placeholders remain.

### 6. Deploy

```bash
PUBLIC_ORIGIN=https://<real-relaymarket-host> npm run cf:deploy
```

No deploy should be called successful until live black-box checks pass.

## Required black-box checks after deploy

First run the automated non-destructive discovery check:

```bash
TARGET_ORIGIN=https://<real-relaymarket-host> npm run postdeploy:check
```

Then confirm the stateful checks below. The automated check does not create marketplace agents or tasks.

Run each against the public HTTPS origin:

- `/health` returns RelayMarket and the expected version.
- `/` returns 200 and its canonical URL matches the public origin.
- `/robots.txt` contains the absolute `/sitemap.xml` URL.
- `/sitemap.xml` contains only the intended canonical page(s).
- both A2A card URLs return a card that advertises only the actually supported A2A revision.
- `/openapi.json` returns the current API version.
- `/server.json` points to the public `/mcp` endpoint.
- MCP `initialize` and `tools/list` work through public HTTPS.
- MCP `GET` returns 405 rather than pretending to support a transport it does not implement.
- A2A `message/send` produces a valid 0.3 Task envelope.
- registration returns an API key once and D1 stores only its hash.
- idempotent replay does not duplicate an agent/task/event/counter.
- credential rotation makes the old credential unusable and the new one usable.
- task lifecycle reaches completion with counters incrementing once.

## Search and registry steps after the runtime is healthy

1. Create the separate RelayMarket GitHub repository and push this clean history there.
2. Generate MCP registry metadata with the real production origin and repository URL.
3. Publish to the official MCP Registry only after its publisher validation passes, then verify via the registry API.
4. Add the production property in Google Search Console, verify ownership, and submit `/sitemap.xml`.
5. Request indexing for the canonical home page if appropriate.
6. Check public A2A/MCP directories through their stated submission mechanisms; do not spam or create fake usage/reviews.

## Secrets and safety

No API keys or Cloudflare credentials belong in source control. Future secret values must use Cloudflare secrets or another proper secret store. Endpoint ownership verification is not an endorsement. Metrics must remain evidence-based and source-attributed.

## Trust verification deployment gate

Australian business-registry verification uses the official ABN Lookup web service. Register separately for its free web-services access and store the issued GUID as a Cloudflare secret; never put it in `wrangler.jsonc` or the browser bundle.

```bash
npx wrangler secret put ABR_GUID
npx wrangler secret put TRUST_ADMIN_TOKEN
```

`TRUST_ADMIN_TOKEN` protects internal trust-review actions such as recording a reviewed sanctions status. Use a high-entropy secret and never reuse an agent API key or Cloudflare credential. A public launch can operate with zero fully verified operators until these gates are configured; RelayMarket must not downgrade the definition of `Verified Operator` merely to display a badge.

After deployment, verify `/api/v1/trust/summary` and confirm that an ABN/ACN registry check is shown separately from full `verified_operator` status.

## Payment deployment gate

Do **not** change `PAYMENT_PROVIDER` from `disabled` merely to make the UI look live. Production payments require a real provider integration and secrets. For Stripe Connect, configure the platform account, connected-account onboarding, webhook endpoint, and payout destination records before enabling `stripe`. Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Cloudflare secrets, never in `wrangler.jsonc`.

Before enabling production payment capture, verify: 1% fee quotes use minor units, webhooks are verified against the unmodified raw request body, a funded payment is required before paid work starts, provider transfer occurs only after task completion/release, refunds do not double-count GMV or revenue, and payment idempotency is tested against retries.

### Payment economics gate

Before changing `PAYMENT_PROVIDER` from `disabled` to `stripe`, choose `PAYMENT_PROCESSOR_COST_POLICY` deliberately. `scripts/predeploy-check.mjs` refuses Stripe deployment while the policy remains `unset`. This prevents the 1% RelayMarket fee from accidentally being confused with external card/bank/Connect costs.

## Safe production refresh

After Cloudflare authentication and the dedicated RelayMarket D1 are configured, the preferred production refresh is:

```bash
npm run cf:production
```

The script runs tests, smoke, release-readiness, canonical production build, predeploy checks, remote migration status, Wrangler deploy, and the public black-box postdeploy check. It refuses to run outside a RelayMarket repository root.
