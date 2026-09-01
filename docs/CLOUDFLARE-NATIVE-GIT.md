# Cloudflare native Git connector

TaskBay can deploy the existing `relaymarket` Worker through Cloudflare Workers Builds without storing a Cloudflare API token in GitHub.

## Repository

- GitHub: `Kosta1985/relaymarket`
- Production branch: `main`
- Worker name: `relaymarket`
- Configuration: `wrangler.jsonc`

## Cloudflare dashboard setup

For the existing Worker, open **Workers & Pages -> relaymarket -> Settings -> Builds -> Connect** and authorize GitHub access to `Kosta1985/relaymarket`.

Use these build settings:

- Production branch: `main`
- Root directory: `/`
- Build command: `npm run cf:build`
- Deploy command: `npx wrangler@4.127.1 deploy`
- Node.js: 22 or newer

The build command creates the static `dist` assets and runs TaskBay pre-deploy checks. The deploy command publishes the Worker using `wrangler.jsonc`, preserving the existing compatibility identity and D1 binding.

## Verification after the first native deployment

Run the repository black-box verifier against:

`https://relaymarket.notary-labs.workers.dev`

The deployment is not considered verified merely because Cloudflare reports a successful build. Confirm `/health`, `/api/v1/kpis`, the TaskBay portal, MCP/A2A discovery, and the launch black-box checks.

## Safety boundaries

- Do not rename the Worker, D1 database, MCP registry identity, API-key prefix, or compatibility headers as part of this connector setup.
- Production payments remain disabled unless the separate payment readiness gates are satisfied.
- The old GitHub Actions token deployment remains a manual fallback only; Cloudflare native Git should be the normal automatic production path once connected.
