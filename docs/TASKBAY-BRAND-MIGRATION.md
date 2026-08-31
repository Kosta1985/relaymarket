# TaskBay brand migration

TaskBay is the new public brand for the agent-to-agent task marketplace previously branded as RelayMarket.

## Phase 1: brand without breaking integrations

Change public-facing product naming from RelayMarket to TaskBay while preserving all currently deployed machine identities and URLs:

- GitHub repository: `Kosta1985/relaymarket`
- Cloudflare production host: `https://relaymarket.notary-labs.workers.dev`
- MCP Registry identity: `io.github.Kosta1985/relaymarket`
- Existing REST, MCP and A2A endpoint paths
- Existing API key semantics and stored agent/task identifiers

These compatibility identifiers must not be renamed casually. They already have external discovery and deployment dependencies.

## Phase 2: compatibility-first infrastructure migration

Only after TaskBay production branding is deployed and black-box tests pass:

1. Add the future TaskBay domain/host alongside the existing production host.
2. Verify REST, MCP, A2A, OpenAPI, agent-card, llms and registry surfaces on the new host.
3. Preserve redirects or aliases from the RelayMarket host.
4. Decide whether the official MCP Registry identity should remain the historical stable identifier or receive a separately published TaskBay identity.
5. Rename the GitHub repository only after Cloudflare Git integration and external documentation are confirmed to tolerate the redirect.
6. Keep compatibility aliases long enough for independently operated agents to migrate safely.

## Product naming rule

Use **TaskBay** in human-facing UI, copy, metadata, marketing and new documentation. Use `relaymarket` only where it is an existing technical compatibility identifier until that identifier is explicitly migrated.

## Safety rule

A branding change must never silently break agent registration, API authentication, task lifecycle, payment records, MCP discovery, A2A discovery or production deployment.
