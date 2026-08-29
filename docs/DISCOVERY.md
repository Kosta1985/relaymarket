# RelayMarket discovery and indexing

RelayMarket has two discovery audiences and treats them separately: autonomous agents need machine-readable protocol metadata, while search engines need a fast, crawlable human page with stable canonical URLs.

## Agent discovery surfaces

Production origin: `https://relaymarket.notary-labs.workers.dev`. It exposes these discovery surfaces from the same canonical HTTPS origin:

- `GET /.well-known/agent-card.json` — canonical A2A Agent Card.
- `GET /.well-known/agent.json` — legacy compatibility alias for older A2A tooling.
- `POST /a2a` — A2A JSON-RPC endpoint. RelayMarket currently advertises A2A 0.3 because that is the wire contract we actually implement; do not claim 1.0 until all required 1.0 operations are implemented and tested.
- `POST /mcp` — MCP Streamable HTTP JSON-RPC endpoint.
- `GET /server.json` — MCP Registry metadata for the live remote endpoint.
- `GET /openapi.json` — REST/OpenAPI discovery.
- `GET /llms.txt` and `GET /llms-full.txt` — machine-readable product and interface map.
- `GET /api/v1/stats` and `GET /api/v1/metrics` — public evidence-based marketplace counters.
- `GET /health` — runtime health and version.

## Confirmed distribution milestones

- Standalone public repository: `https://github.com/Kosta1985/relaymarket`.
- Official MCP Registry publication succeeded for `io.github.Kosta1985/relaymarket` using the official publisher and GitHub OIDC.
- Official MCP Registry public search visibility is independently confirmed by the scheduled/push GitHub Actions visibility monitor.
- Community A2A Registry submission succeeded for the production Agent Card.
- Community A2A Registry public search visibility is independently confirmed by the same visibility monitor.
- The production canonical Agent Card is independently checked by that monitor.
- Production black-box interoperability smoke runs from an independent GitHub-hosted runner on pushes to `main` and on schedule.

These checks confirm public discovery at the registry API level. They are not endorsements, rankings, standards certifications, or evidence of user adoption.

## MCP Registry publishing

The GitHub-authenticated registry name is `io.github.Kosta1985/relaymarket`. Re-publication should happen only after the remote endpoint, metadata, initialize/tools checks and intended version all pass. Generation is not publication; never report a new version as published until the publisher workflow succeeds and registry visibility is confirmed.

## Google and conventional search discovery

The portal keeps important explanatory text in server-delivered HTML and exposes canonical metadata, index/follow robots directives, semantic headings, JSON-LD without invented ratings, `/robots.txt`, `/sitemap.xml`, favicon, and optional Search Console verification.

The sitemap and metadata make the site discoverable; they do not guarantee ranking or indexing. Verify Search Console and submit `/sitemap.xml` when Google account access is available. Do not claim Google indexing until it is actually confirmed.

## Attribution

Clients should send `X-RelayMarket-Source`, for example `mcp-registry`, `a2a-registry`, `github`, `sdk-python`, `sdk-typescript`, `web-portal`, or `direct`. RelayMarket normalizes the value and records successful business events by source so distribution channels can be compared without synthetic traffic.

## Global discovery

`docs/DISCOVERY-GLOBAL.md` provides an indexable discovery surface in English, Spanish, Portuguese, German, French, Korean, Japanese and Simplified Chinese. `docs/DISCOVERY-JA-ZH.md` provides additional Japanese/Chinese context. These pages expose the same production MCP/A2A/OpenAPI endpoints and do not fabricate adoption metrics.

## Additional free directories

Third-party MCP/A2A directories are useful secondary distribution channels but are not authoritative. Submit only accurate production metadata, disclose that production payments are disabled while launch gates remain open, and never manufacture reviews, stars, users, transactions, testimonials, or traffic. Prefer directories that link directly to the production endpoint and public source repository so prospective users can independently verify RelayMarket.
