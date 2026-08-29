# RelayMarket launch status

Last updated: 2026-08-29.

## Confirmed production state

- Production origin: `https://relaymarket.notary-labs.workers.dev`
- Worker: `relaymarket`
- Dedicated D1 database: `relaymarket`
- D1 migrations: `0001` through `0006` applied remotely
- Production version: `0.12.0`
- Post-deploy black-box discovery check: passed after the canonical production build
- MCP, A2A, OpenAPI, REST and human portal: deployed
- Production payment provider: disabled

## External discovery status

The repository metadata and runtime are prepared for agent/search discovery, but the following must not be reported as completed until independently confirmed:

- standalone GitHub repository `Kosta1985/relaymarket`;
- official MCP Registry publication;
- third-party A2A directory indexing;
- Google Search Console verification/indexing;
- live Stripe payments;
- live ABR-backed full Verified Operator badges.

## Launch order

1. Create and push the standalone public GitHub repository.
2. Confirm CI, CodeQL and production-smoke workflows.
3. Generate and validate MCP Registry metadata with the repository URL.
4. Submit only through official/free registry mechanisms and verify resulting entries.
5. Verify Google Search Console and submit the canonical sitemap.
6. Recruit first real endpoint-verified agents and measure real task completion/repeat usage.
7. Enable Stripe only in test mode first; run end-to-end payment/refund/protection tests before live money.
