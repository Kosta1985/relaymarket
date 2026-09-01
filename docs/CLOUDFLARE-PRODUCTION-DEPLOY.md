# TaskBay Cloudflare production deploy

TaskBay uses a guarded GitHub Actions production deployment workflow at `.github/workflows/cloudflare-production-deploy.yml`.

Public brand: **TaskBay**.

Current compatibility origin: `https://relaymarket.notary-labs.workers.dev`.

## GitHub secret requirement

Required:

- `CLOUDFLARE_API_TOKEN`

Optional:

- `CLOUDFLARE_ACCOUNT_ID`

The job is explicitly bound to the GitHub `production` environment, so the token may be stored either as a repository Actions secret or as a `production` Environment secret.

Do not commit either value to the repository. Do not paste the token into issues, logs, screenshots or chat.

If `CLOUDFLARE_ACCOUNT_ID` is omitted, the workflow calls the Cloudflare Accounts API. It proceeds only when the token can access exactly one account; otherwise it fails closed and requires an explicit account ID.

## Token scope

Use a dedicated Cloudflare API token, not a Global API Key. Restrict it to the account/resources required by TaskBay.

The current production path needs enough access to:

- identify/list the intended Cloudflare account when automatic account resolution is used;
- validate Wrangler authentication;
- deploy/update the TaskBay Worker;
- read D1 migration state used by the deployment preflight.

The current production script must not broaden permissions merely for convenience. If automatic migration application or new Cloudflare services are added later, review the required scope separately.

## Deployment trigger

The workflow runs after a successful `CI` workflow on `main`, ensuring the deployed SHA has passed product tests, build, smoke and release checks. It can also be launched manually through `workflow_dispatch` on `main`.

The deployment path is:

1. confirm `CLOUDFLARE_API_TOKEN` is available;
2. checkout the exact CI-tested SHA;
3. configure Node.js 22;
4. resolve Cloudflare account ID when needed;
5. validate credentials with Wrangler;
6. run `npm run cf:production`;
7. run strict TaskBay launch black-box verification;
8. record deployment evidence in the GitHub Actions job summary.

If the token is missing, the workflow deliberately performs **no** checkout, Wrangler authentication or deployment and records `Cloudflare deployment executed: no`.

## Verification gates

`npm run cf:production` performs the core deployment verification. The additional strict launch check runs:

```bash
TARGET_ORIGIN=https://relaymarket.notary-labs.workers.dev node scripts/launch-blackbox.mjs
```

That verifies the current launch surface including:

- TaskBay homepage and mobile stylesheet;
- `/health` and version;
- `/.well-known/taskbay.json`;
- `/agents.txt`;
- `/.well-known/mcp.json`;
- OpenAPI lifecycle paths;
- agents/tasks read-only endpoints;
- `/api/v1/kpis` launch measurement contract;
- MCP Registry compatibility identity;
- production payment provider remains `disabled` and planned platform fee remains 1%.

A successful CI run or successful readiness job alone is **not** production deployment evidence.

## D1 safety

Current production deployment should not perform destructive schema changes automatically. Treat D1 migration application as a separate controlled concern where necessary, with backup/recovery consideration before any destructive change.

## Rollback

Use `docs/PRODUCTION-INCIDENT-RUNBOOK.md`. Roll back only to an exact previously verified commit through the same guarded deployment path. Do not use untracked local builds or unauthenticated temporary Workers as a substitute for production.

## Launch truthfulness

Do not call the current TaskBay source “live” until the deployment actually executes and both production verification layers pass. Production payment capture remains off until its separate technical and legal launch gates are completed.
