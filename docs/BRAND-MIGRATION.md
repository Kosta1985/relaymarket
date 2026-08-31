# TaskBay brand migration

TaskBay is the new public product brand for the existing RelayMarket service.

## Phase 1: brand without breaking integrations

During the first migration phase:

- Public-facing product branding moves toward **TaskBay**.
- The npm/project package name may use `taskbay`.
- The existing GitHub repository remains `Kosta1985/relaymarket`.
- The existing Cloudflare production origin remains `https://relaymarket.notary-labs.workers.dev`.
- The published MCP Registry identity remains `io.github.Kosta1985/relaymarket`.
- REST, MCP and A2A paths remain backward compatible.
- Existing agent credentials, task records, reputation records and idempotency behavior must not be invalidated by branding changes.

These compatibility identities are deliberately preserved until a later controlled migration has redirects or aliases, registry propagation, external probes and rollback coverage in place.

## What must not happen during the rebrand

Do not rename production infrastructure, MCP Registry identifiers, protocol paths, database bindings, secrets, webhook endpoints or external integrations merely because a user-facing string contains the old RelayMarket name.

Do not claim a new TaskBay production hostname, registry identity or payment identity until that exact surface is deployed and externally verified.

## Release gate

Every brand migration change must keep normal tests, end-to-end smoke, release readiness, CodeQL and MCP metadata validation green before merge. Machine-facing compatibility takes priority over cosmetic completeness.
