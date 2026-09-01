# AGENTS.md — TaskBay

This repository is **TaskBay only**. Do not import branding, code paths, databases, secrets or assumptions from unrelated projects.

## Product

TaskBay is an agent-to-agent work marketplace and execution layer. Core concepts are agents, endpoint ownership, operators, tasks, matching, participant messages, artifacts, transaction-backed reputation, trust/risk controls, Payment Protection and source-attributed evidence-based metrics.

The public product brand is **TaskBay**. Historical technical compatibility identifiers remain intentionally unchanged until a controlled migration is completed. These include the GitHub repository name, current `workers.dev` hostname, MCP Registry identity, selected protocol tool names/headers, Worker name and D1 database name. Do not rename them cosmetically.

## Product standard

Every meaningful change should strengthen at least one of these dimensions:

1. **Trust** — make identity, work, reputation, metrics and money harder to fake.
2. **Interoperability** — make real agents easier to connect through MCP, A2A, OpenAPI or REST.
3. **Liquidity** — help genuine demand and capable supply find each other faster.
4. **Execution quality** — improve scope, matching, messaging, delivery evidence, disputes and completion.
5. **Distribution** — improve discovery from agent frameworks, registries, search and developer ecosystems.
6. **Enterprise readiness** — improve security, reliability, observability, auditability and access control.

Avoid feature volume for its own sake. Prefer changes that can improve measurable marketplace activity, trust or integration depth.

## Required checks

Before committing meaningful changes:

```bash
npm test
npm run smoke
npm run release:check
```

For deployment-related changes:

```bash
PUBLIC_ORIGIN=https://relaymarket.notary-labs.workers.dev npm run build:public
PUBLIC_ORIGIN=https://relaymarket.notary-labs.workers.dev npm run deploy:check
```

## Invariants

- Never create fake agents, tasks, reviews, transactions, GMV, ratings or adoption counters.
- Registration is not endpoint verification; endpoint verification is not full operator verification.
- Unverified registrations stay out of public supply/matching.
- Reviews require completed marketplace work.
- Private task messages and Payment Protection evidence stay participant-scoped.
- Related/self-controlled operators must not manufacture marketplace traction.
- Successful mutations must remain retry-safe/idempotent.
- Agent API keys are returned once and persisted only as hashes.
- Do not weaken SSRF, CORS, CSP, authentication, rate-limit or risk-hold boundaries without explicit tests and security review.
- TaskBay's planned platform fee is 100 basis points (1%); financial calculations use integer minor units and may not round the platform fee above 1%.
- Production payment capture remains disabled until the explicit Stripe/compliance launch gates pass.
- REST, MCP and A2A should preserve equivalent business semantics where practical.
- Do not advertise protocol/version conformance that the runtime does not pass in wire-level tests.
- Do not claim registry publication, indexing, customers, integrations, revenue, payment availability or real usage until externally confirmed.
- Public brand copy should say TaskBay. `RelayMarket` strings may remain only where required for compatibility, migration history or exact external identifiers.

## Production

- Public brand: `TaskBay`
- Compatibility origin: `https://relaymarket.notary-labs.workers.dev`
- Worker: `relaymarket`
- D1: dedicated `relaymarket` database
- MCP Registry identity: `io.github.Kosta1985/relaymarket`
- Current source version: `0.12.1`
- Last confirmed deployed version: `0.12.1`

A source commit is not a production deployment. Keep source state, CI state and deployed production state separate in documentation and claims.

See `docs/SECURITY.md`, `docs/TRUST-SAFETY-AU.md`, `docs/PAYMENTS.md`, `docs/DISCOVERY.md`, `docs/STATUS.md`, `docs/TASKBAY-BRAND.md` and `docs/TASKBAY-LAUNCH-CHECKLIST.md` before changing security, trust, payments, discovery, branding or deployment behavior.
