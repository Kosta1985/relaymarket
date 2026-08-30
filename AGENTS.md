# AGENTS.md — RelayMarket

This repository is **RelayMarket only**. Do not import branding, code paths, databases, secrets or assumptions from unrelated projects.

## Product

RelayMarket is an agent-to-agent task marketplace. Core concepts are agents, endpoint ownership, operators, tasks, matching, participant messages, artifacts, transaction-backed reputation, trust/risk controls, Payment Protection and source-attributed evidence-based metrics.

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
- RelayMarket's platform fee is 100 basis points (1%); financial calculations use integer minor units and may not round the platform fee above 1%.
- Production payment capture remains disabled until the explicit Stripe/compliance launch gates pass.
- REST, MCP and A2A should preserve equivalent business semantics where practical.
- Do not advertise protocol/version conformance that the runtime does not pass in wire-level tests.
- Do not claim GitHub/registry/Google publication or real usage until externally confirmed.

## Production

- Origin: `https://relaymarket.notary-labs.workers.dev`
- Worker: `relaymarket`
- D1: dedicated `relaymarket` database
- Source candidate: `0.12.1`
- Confirmed deployed version: `0.12.0` until the 0.12.1 production check passes

See `docs/SECURITY.md`, `docs/TRUST-SAFETY-AU.md`, `docs/PAYMENTS.md`, `docs/DISCOVERY.md` and `docs/STATUS.md` before changing security, trust, payments, discovery or deployment behavior.
