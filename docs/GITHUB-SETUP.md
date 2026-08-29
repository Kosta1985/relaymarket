# Standalone GitHub setup

RelayMarket must live in its own repository. Do not push it into any previous project repository.

Target repository: `Kosta1985/relaymarket`.

## One-time creation from the WSL working copy

After installing/authenticating GitHub CLI:

```bash
cd ~/relaymarket
gh auth login
gh repo create Kosta1985/relaymarket --public --source=. --remote=origin --push
```

Before pushing, confirm:

```bash
git remote -v
git status
git log --oneline -5
npm test
npm run smoke
npm run release:check
```

The expected `origin` after creation is `https://github.com/Kosta1985/relaymarket.git` (or the equivalent authenticated SSH URL).

## Repository settings to enable

- GitHub Private Vulnerability Reporting / Security Advisories.
- Dependabot alerts and security updates.
- Branch protection/ruleset for `main`: require pull request and CI for normal changes once the initial import is complete.
- Preserve Actions permissions needed by CodeQL and the manually dispatched MCP Registry publisher (`id-token: write`).

## Included workflows

- `CI` — tests, build and smoke.
- `CodeQL` — static security analysis.
- `Production discovery smoke` — non-destructive public checks every six hours.
- `MCP Registry metadata validate` — validates generated production `server.json` with the official publisher.
- `Publish MCP Registry` — **manual only**, authenticates via GitHub OIDC and publishes after tests/validation.
- `Submit to community A2A Registry` — **manual only**, submits the already-live Agent Card through the registry's public registration API.

External publication is never inferred from workflow presence. A publication is complete only after the external registry confirms it.

For the guarded one-command path included in the repository:

```bash
npm run github:publish
```

The script refuses to run outside RelayMarket, refuses a dirty working tree, refuses an `origin` that points to another repository, runs release/test/smoke checks, and only creates `Kosta1985/relaymarket`.
