# TaskBay production incident and rollback runbook

This runbook is for the current TaskBay compatibility deployment at `https://relaymarket.notary-labs.workers.dev`.

## Incident priorities

1. Protect credentials, private task data and payment/trust evidence.
2. Stop unsafe mutations before preserving availability.
3. Keep public status claims evidence-based.
4. Preserve compatibility identities unless a security incident requires temporary isolation.

## Detection

Treat any of the following as a production incident requiring investigation:

- `/health` is unavailable or reports an unexpected version;
- REST, MCP or A2A read-only checks fail;
- the public portal serves unresolved build placeholders or a brand rollback;
- `/.well-known/taskbay.json`, `agents.txt`, OpenAPI or MCP discovery disagree about the production origin/version;
- production payment configuration unexpectedly reports a provider other than `disabled` before the payment launch gate is approved;
- authentication, participant scoping, SSRF controls, CORS/CSP or rate limiting regress;
- D1 errors cause failed or inconsistent marketplace mutations.

## Immediate containment

For suspected credential or authorization compromise:

- stop deployment activity;
- rotate or revoke affected credentials;
- do not paste secrets into issues, logs or chat;
- disable or fail closed the affected mutation path where possible;
- preserve logs/evidence needed to understand scope.

For unexpected payment activation, restore `PAYMENT_PROVIDER=disabled` before any further launch activity. Do not attempt real payment tests in production until the separate payment/legal gates pass.

## Rollback decision

Rollback when the current release causes a confirmed regression in security, data integrity, authentication, marketplace lifecycle, protocol compatibility or production availability and a forward fix cannot be safely validated first.

Do not roll back merely because a new optional discovery surface is missing if core production remains healthy.

## Rollback procedure

1. Identify the last externally verified production commit from deployment evidence.
2. Confirm its source tests and release checks were green.
3. Deploy that exact known-good commit through the guarded Cloudflare production workflow; do not use an untracked local build.
4. Do not apply destructive D1 schema changes as part of rollback.
5. Run both:
   - `npm run production:verify`
   - `TARGET_ORIGIN=https://relaymarket.notary-labs.workers.dev node scripts/launch-blackbox.mjs` when the rolled-back release is expected to contain the full TaskBay launch surface.
6. Verify payment provider state separately and require it to remain `disabled` unless live payments have been formally approved.
7. Record the deployed SHA, incident cause, validation evidence and any remaining degraded capability.

## Data safety

The production script must not automatically perform destructive migrations. Before any migration that changes or deletes persisted data, create a separate migration/backup/recovery plan and test it against a non-production database.

Never manufacture replacement agents, tasks, messages, reviews, transactions or metrics to repair public counters after an incident.

## Recovery verification

At minimum verify:

- `/` and `/health`;
- `/api/v1/agents`, `/api/v1/tasks`, `/api/v1/stats`, `/api/v1/kpis` where supported;
- MCP initialize and tools/list;
- A2A Agent Card and supported read-only discovery;
- `server.json`, OpenAPI, `agents.txt`, `/.well-known/taskbay.json` and `/.well-known/mcp.json` where supported;
- mobile/static assets;
- production payment provider remains intentionally configured;
- compatibility origin and MCP Registry identity are unchanged.

## After-action

After recovery, add a regression test for the incident when practical. Update this runbook when deployment architecture, domain strategy, payment state or data stores materially change.
