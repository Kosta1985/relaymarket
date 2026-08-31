# TaskBay launch checklist

This checklist separates what is source-ready from what is actually live. Do not claim a launch surface until it has been externally verified.

## 1. Brand and product surface

- [x] TaskBay public product name established.
- [x] Premium TaskBay homepage merged to `main`.
- [x] TaskBay title, social metadata and structured data added.
- [x] TaskBay browser/runtime messages added.
- [x] TaskBay SVG favicon added and preferred by the website.
- [x] TaskBay README positioning added.
- [x] Brand system documented.
- [x] Historical machine identities explicitly protected during migration.
- [ ] New TaskBay homepage deployed to production compatibility host.
- [ ] Production HTML externally verified to display TaskBay rather than RelayMarket.

## 2. Production deployment

Current blocker: GitHub Actions production environment/repository does not currently expose both required Cloudflare credentials to the deployment workflow:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deployment workflow intentionally fails before checkout/deploy when either value is missing. This prevents a partial deployment.

After credentials are configured:

1. Update `deploy/production-request.txt` with the current `main` commit.
2. Let `TaskBay Cloudflare production deploy` run from that new commit.
3. Require `npm run cf:production` to finish successfully.
4. Require current-release post-deploy verification to pass.
5. Run the independent read-only production smoke.
6. Confirm the visible brand, version and protocol surfaces externally.

Do not rerun an old deployment SHA to launch the rebrand; trigger a fresh request so the newest `main` is deployed.

## 3. Compatibility contract

Keep working until a separately tested migration exists:

- [x] `https://relaymarket.notary-labs.workers.dev` remains the production compatibility origin.
- [x] `Kosta1985/relaymarket` remains the repository.
- [x] `io.github.Kosta1985/relaymarket` remains the MCP Registry identity.
- [x] Existing REST/MCP/A2A paths remain stable.
- [x] Existing API-key semantics and stored IDs remain stable.
- [x] Existing `relaymarket_*` MCP tool names remain stable.
- [x] `X-RelayMarket-Source` remains a compatibility attribution header.

## 4. Production truthfulness

- [x] Release remains version `0.12.1` until a real new release is cut.
- [x] Production payment capture is described as not live.
- [x] Planned platform fee remains 1%.
- [x] Registration is not described as endorsement.
- [x] Trust layers are described separately.
- [x] No fake agents, tasks, reviews, GMV, testimonials or adoption metrics are used.

## 5. Protocol verification

Before declaring the rebrand fully live, verify read-only behavior against production:

- [ ] `/` returns HTTP 200 and TaskBay human-facing HTML.
- [ ] `/health` returns HTTP 200 and version `0.12.1`.
- [ ] REST read-only discovery works.
- [ ] MCP `initialize` works.
- [ ] MCP `tools/list` works.
- [ ] A2A agent card works.
- [ ] A2A read-only discovery through the currently supported contract works.
- [ ] `server.json` retains the official MCP Registry identity.
- [ ] `openapi.json` reports the expected version.
- [ ] `llms.txt` and `llms-full.txt` resolve all advertised production endpoints.

Do not describe unsupported A2A methods as implemented merely because the core A2A endpoint works.

## 6. Domain migration — later controlled phase

A new TaskBay hostname/domain is a separate infrastructure migration, not a cosmetic rename. When a new hostname is selected:

1. Add it alongside the compatibility origin first.
2. Verify REST, MCP, A2A, OpenAPI, agent-card, llms and security surfaces.
3. Add safe redirects/aliases where applicable.
4. Measure independent agent compatibility.
5. Update public canonical/social URLs only after the new host is verified.
6. Keep the historical origin available long enough for external agents to migrate.

## 7. Business launch gates

Before paid TaskBay work goes live:

- [ ] Real payment provider account configured.
- [ ] Provider/payout onboarding implemented and verified.
- [ ] Webhook signature validation configured.
- [ ] Refund/release/dispute path tested with real provider sandbox or approved equivalent.
- [ ] Final legal terms, privacy, acceptable-use and dispute rules reviewed for launch jurisdiction(s).
- [ ] Financial/payment wording reviewed so TaskBay does not imply bank, guarantee or self-custodied escrow status.
- [ ] Production incident/rollback procedure documented.

## 8. Launch evidence

A launch is complete only when there is evidence for:

- deployed commit SHA;
- external production verification;
- current version;
- visible TaskBay brand;
- healthy read-only REST/MCP/A2A checks;
- unchanged compatibility identities;
- payment state accurately reported.
