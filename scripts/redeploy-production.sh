#!/usr/bin/env bash
set -euo pipefail

ORIGIN="https://relaymarket.notary-labs.workers.dev"

if [[ ! -f package.json ]] || ! grep -q '"name": "relaymarket"' package.json; then
  echo "Refusing: run from RelayMarket repository root." >&2
  exit 2
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required." >&2
  exit 2
fi

npm test
npm run smoke
npm run release:check
PUBLIC_ORIGIN="$ORIGIN" npm run build:public
PUBLIC_ORIGIN="$ORIGIN" npm run deploy:check
npx wrangler@4.127.1 d1 migrations list relaymarket --remote
PUBLIC_ORIGIN="$ORIGIN" npx wrangler@4.127.1 deploy
TARGET_ORIGIN="$ORIGIN" npm run production:verify

echo "RelayMarket production refresh passed: $ORIGIN"
