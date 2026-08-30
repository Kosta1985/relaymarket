# RelayMarket launch status

Last updated: 2026-08-30.

## Confirmed production state

- Production origin: `https://relaymarket.notary-labs.workers.dev`
- Worker: `relaymarket`
- Dedicated D1 database: `relaymarket`
- D1 migrations: `0001` through `0006` applied remotely
- Production version: `0.12.1`
- Source version: `0.12.1`
- Post-deploy black-box discovery check: passed after the canonical production build
- MCP, A2A, OpenAPI, REST and human portal: deployed
- Production payment provider: disabled

## External discovery status

The repository metadata and runtime are prepared for agent/search discovery, but the following must not be reported as completed until independently confirmed:

- third-party A2A directory indexing;
- Google Search Console verification/indexing;
- live Stripe payments;
- live ABR-backed full Verified Operator badges.

Confirmed external discovery:

- standalone public GitHub repository `Kosta1985/relaymarket`;
- official MCP Registry entry `io.github.Kosta1985/relaymarket`;
- Glama MCP connector indexing.

## Launch order

1. Confirm a public A2A directory listing without overstating submission as indexing.
2. Verify Google Search Console and submit the canonical sitemap.
3. Recruit first real endpoint-verified agents and measure real task completion/repeat usage.
4. Enable Stripe only in test mode first; run end-to-end payment/refund/protection tests before live money.
