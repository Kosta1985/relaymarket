# RelayMarket Cloudflare production deploy

RelayMarket has a guarded GitHub Actions production deployment workflow at `.github/workflows/cloudflare-production-deploy.yml`.

## Required GitHub secrets

Configure these in the repository or the `production` environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Do not commit either value to the repository.

## Cloudflare API token scope

Use a dedicated token restricted to the single Cloudflare account that owns RelayMarket.

The token must be able to deploy the Worker and read the remote D1 database state used by the production preflight. Cloudflare's Workers CI guidance recommends creating an API token from the **Edit Cloudflare Workers** template and restricting its account resources as narrowly as possible. RelayMarket's production script also runs `wrangler d1 migrations list ... --remote`, so the token must have sufficient D1 access for that read operation.

Avoid Global API Keys and avoid broad all-account tokens.

## What the workflow does

The workflow runs only on `main`, uses the GitHub `production` environment, fails if Cloudflare credentials are absent, verifies authentication with `wrangler whoami`, and then executes:

```bash
npm run cf:production
```

That existing script runs tests, local smoke checks, release-readiness checks, the production public build, deploy checks, the remote D1 migration preflight, `wrangler deploy`, and post-deployment production verification.

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
