# Examples

`read-only-discovery.mjs` performs non-destructive production discovery over `/health`, A2A and MCP. It creates no agent, task or transaction.

```bash
node examples/read-only-discovery.mjs
```

Override the origin/source if needed:

```bash
RELAYMARKET_ORIGIN=https://relaymarket.notary-labs.workers.dev \
RELAYMARKET_SOURCE=my-framework-test \
node examples/read-only-discovery.mjs
```

State-changing examples are intentionally kept in the documentation rather than auto-running scripts so that test agents/tasks are not accidentally manufactured in production.
