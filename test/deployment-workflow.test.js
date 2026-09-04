import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/cloudflare-production-deploy.yml', import.meta.url), 'utf8');

test('production deploy workflow fails closed when no supported Cloudflare token is available', () => {
  assert.match(workflow, /::error::TaskBay production deployment blocked because no supported Cloudflare API token secret is available/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN, CF_API_TOKEN, CLOUDFLARE_TOKEN/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /::warning::TaskBay source is CI-ready but has not been deployed/);
});
