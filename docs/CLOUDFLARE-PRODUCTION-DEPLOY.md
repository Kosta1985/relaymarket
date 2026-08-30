# RelayMarket Cloudflare production deploy

RelayMarket has a guarded GitHub Actions production deployment workflow at `.github/workflows/cloudflare-production-deploy.yml`.

## Required GitHub secrets

Configure these in the repository or the `production` environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Do not commit either value to the repository. Local Wrangler credential files such as `.dev.vars`, `.dev.vars.*`, `.env`, and `.env.*` are ignored by Git; `.env.example` remains tracked as documentation.

## Cloudflare API token scope

Use a dedicated API token restricted to the single Cloudflare account that owns RelayMarket. Do not use a Global API Key.

The token needs only the permissions required by the current production script:

- permission to edit/deploy Cloudflare Workers for the RelayMarket account;
- read access to D1, because the pre-deploy gate runs `wrangler d1 migrations list relaymarket --remote`.

The current production script does **not** apply D1 migrations. If automatic migration application is added later, review and deliberately expand the token permissions rather than reusing a broader token in advance.

Cloudflare's Workers CI guidance recommends API-token authentication and narrowing account resources as much as possible.

## What the workflow does

The workflow runs only on `main`, uses the GitHub `production` environment, fails closed if Cloudflare credentials are absent, validates authentication with `wrangler whoami`, and then executes:

```bash
npm run cf:production
```

That existing script runs tests, local smoke checks, release-readiness checks, the production public build, deploy checks, the remote D1 migration-list preflight, `wrangler deploy`, and post-deployment production verification.

## Triggering a deployment

Use **Actions → Cloudflare production deploy → Run workflow** after the two secrets are configured.

A deployment can also be intentionally requested by updating `deploy/production-request.txt` on `main`. Ordinary application commits do not automatically deploy production.

## Required post-deploy evidence

A deployment is not considered complete unless the workflow succeeds through post-deployment verification. After the next authorized deploy, additionally confirm externally that:

1. `https://relaymarket.notary-labs.workers.dev/` contains the current Founding 100 and payment-status copy.
2. `https://relaymarket.notary-labs.workers.dev/.well-known/mcp.json` returns HTTP 200.
3. The document identifies `io.github.Kosta1985/relaymarket` and the production `/mcp` endpoint.
4. Production payment capture remains disabled unless the payment launch gate has separately been completed.

## Security rule

Do not use unauthenticated Wrangler temporary deployments from public CI logs as a substitute for production. Cloudflare temporary deployment claim URLs are bearer credentials; exposing one in public logs can give whoever possesses it control over the temporary Worker.
