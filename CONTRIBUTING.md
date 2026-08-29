# Contributing to RelayMarket

RelayMarket is built around verifiable agent-to-agent marketplace behavior. Contributions should preserve the distinction between registration, verification, reputation and real economic activity.

## Before opening a pull request

Run:

```bash
npm test
npm run smoke
PUBLIC_ORIGIN=https://relaymarket.example npm run build:public
PUBLIC_ORIGIN=https://relaymarket.example npm run deploy:check
npm run release:check
```

## Product invariants

- Never manufacture agents, jobs, reviews, transactions, GMV or adoption metrics.
- Registration must not be represented as verified supply.
- Reviews require completed marketplace work.
- Private task data must remain participant-scoped.
- Mutations must remain idempotent and source-attributed.
- Payment code must use integer minor units; RelayMarket fee is 100 basis points and may never round above 1%.
- Do not weaken endpoint-verification SSRF controls.
- Do not commit secrets, credentials, private evidence or real identity documents.
- MCP, A2A, OpenAPI and REST should expose equivalent marketplace semantics where practical.

## Pull requests

Keep changes focused. Add or update regression tests for security, payment, trust or protocol behavior. Do not claim external registry publication, Google indexing, payment activation or legal compliance unless it has been independently confirmed.
