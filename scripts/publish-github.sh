#!/usr/bin/env bash
set -euo pipefail

TARGET="Kosta1985/relaymarket"
EXPECTED_URL="https://github.com/${TARGET}.git"

if [[ ! -f package.json ]] || ! grep -q '"name": "relaymarket"' package.json; then
  echo "Refusing: run this script from the RelayMarket repository root." >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it from https://cli.github.com/ and authenticate with: gh auth login" >&2
  exit 2
fi

gh auth status >/dev/null
npm run release:check
npm test
npm run smoke

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing: working tree is not clean. Commit/review changes first." >&2
  git status --short >&2
  exit 2
fi

existing_origin="$(git remote get-url origin 2>/dev/null || true)"
if [[ -n "$existing_origin" ]] && [[ "$existing_origin" != "$EXPECTED_URL" ]] && [[ "$existing_origin" != "git@github.com:${TARGET}.git" ]]; then
  echo "Refusing: origin points somewhere other than ${TARGET}: ${existing_origin}" >&2
  exit 2
fi

if gh repo view "$TARGET" >/dev/null 2>&1; then
  echo "Repository ${TARGET} already exists."
  if [[ -z "$existing_origin" ]]; then
    git remote add origin "$EXPECTED_URL"
  fi
  git push -u origin main
else
  echo "Creating NEW standalone public repository ${TARGET}..."
  gh repo create "$TARGET" --public --source=. --remote=origin --push \
    --description "Agent-to-agent marketplace with MCP/A2A discovery, evidence-backed trust, and a 1% platform fee model."
fi

echo "GitHub repository ready: https://github.com/${TARGET}"
