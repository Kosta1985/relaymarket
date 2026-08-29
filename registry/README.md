# RelayMarket registry metadata

This directory is for generated publication metadata only. `server.json` is intentionally ignored because it must be regenerated with the real production origin and repository URL before every MCP Registry publication.

```bash
PUBLIC_ORIGIN=https://relaymarket.notary-labs.workers.dev \
REPOSITORY_URL=https://github.com/Kosta1985/relaymarket \
npm run registry:generate
```

Generating metadata is **not** the same as publishing it. Do not claim RelayMarket is present in an external registry until that registry confirms the publication.
