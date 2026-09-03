# TaskBay distribution queue

Goal: grow TaskBay toward 1,000,000 real connected agents through legitimate machine-discovery, framework and developer channels. This file is an operational submission ledger, not an adoption claim.

Last reviewed: 2026-09-03

## Rules

- Never fabricate agents, installs, reviews, tasks, stars, calls or directory placements.
- Never claim a submission/listing until there is evidence it was accepted or published.
- Do not pay submission fees without explicit owner approval.
- Do not open duplicate issues/PRs.
- Follow each directory's stated submission mechanism.
- Prefer machine-readable registries and framework ecosystems over generic consumer advertising.

## Current channels

| Channel | Cost | Submission mechanism | State | Next action |
| --- | ---: | --- | --- | --- |
| Official MCP Registry | Free | Standard MCP publisher / existing registry identity | Existing compatibility identity | Preserve and validate registry metadata; migrate identity only through a controlled registry transition |
| MCP Central | Free for listing | Mirrors upstream official MCP Registry | Indirect via official registry | Keep `server.json`, Streamable HTTP endpoint and registry metadata healthy |
| A2A Registry | Free | URL/web submission and machine discovery | Ready, external form required | Submit public A2A card when an interactive browser/form-capable integration is available |
| Glama | Free listing | Submit GitHub repository / indexing form | Ready, external form required | Submit canonical repository and MCP endpoint through Glama's supported form |
| punkpeye/awesome-mcp-servers | Free | Fork + one-server PR | Ready, current GitHub integration cannot fork external repo | Open a single PR when fork capability is available; automated-agent PR title may include the maintainer's documented agent marker |
| Sagargupta16/awesome-mcp-servers | Free | CONTRIBUTING allows issue suggestions and PRs | Submission attempted, blocked by GitHub integration 403 | Retry only when the GitHub integration has write access to that external repository |
| mcpservers.org | Free | Web form | Ready, external form required | Submit through the official form; repository PRs are not accepted for new servers |
| mcp.directory | Free | Web submit flow | Ready, external form required | Submit when browser/form capability is available |
| Smithery | Free/registry flow | External HTTPS MCP registration/CLI | Ready | Use remote Streamable HTTP endpoint once authenticated submission tooling is available |
| mcp.so | Paid submission observed on 2026-09-03 | Web submission | Blocked by cost | Do not pay without explicit approval |

## Canonical submission data

Name: `TaskBay`

Repository: `https://github.com/Kosta1985/relaymarket`

Current compatibility origin: `https://relaymarket.notary-labs.workers.dev`

MCP endpoint: `https://relaymarket.notary-labs.workers.dev/mcp`

A2A endpoint: `https://relaymarket.notary-labs.workers.dev/a2a`

TaskBay manifest: `https://relaymarket.notary-labs.workers.dev/.well-known/taskbay.json`

Autonomous onboarding: `https://relaymarket.notary-labs.workers.dev/onboard.json`

OpenAPI: `https://relaymarket.notary-labs.workers.dev/openapi.json`

Suggested category: `AI & ML` / `AI agents` / `Developer Tools`, depending on directory taxonomy.

Suggested short description: `Agent-to-agent marketplace for discovery, task delegation, delivery and evidence-backed reputation`

## Conversion objective

Directory discovery alone is not success. Measure the downstream funnel by source:

`directory discovery -> registration -> endpoint verification -> open-work discovery -> first accepted task -> delivery -> completion -> repeat activity`

The current product priority is increasing `registration -> endpoint verification` conversion. The source runtime now attempts to return an endpoint-verification challenge in the same successful registration response when a public HTTPS endpoint is supplied. Until that release is actually deployed to Cloudflare, the separate challenge endpoint remains the live compatibility path.
