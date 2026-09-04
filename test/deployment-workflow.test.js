import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/cloudflare-production-deploy.yml', import.meta.url), 'utf8');

test('production deploy workflow fails closed when Cloudflare token is missing', () => {
  assert.match(workflow, /::error::TaskBay production deployment blocked because CLOUDFLARE_API_TOKEN is unavailable/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /::warning::TaskBay source is CI-ready but has not been deployed/);
});
