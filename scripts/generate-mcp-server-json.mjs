import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mcpServerJson } from '../src/discovery.js';

const input = String(process.env.PUBLIC_ORIGIN || '').trim();
if (!input) throw new Error('PUBLIC_ORIGIN is required');
const parsed = new URL(input);
if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
  throw new Error('PUBLIC_ORIGIN must be a bare HTTPS origin');
}
const outputDir = resolve('registry');
await mkdir(outputDir, { recursive: true });
const metadata = mcpServerJson(parsed.origin);
const repositoryUrl = String(process.env.REPOSITORY_URL || '').trim();
if (repositoryUrl) {
  const repo = new URL(repositoryUrl);
  if (repo.protocol !== 'https:' || repo.hostname !== 'github.com') throw new Error('REPOSITORY_URL must be an HTTPS GitHub repository URL');
  metadata.repository = { url: repo.href.replace(/\/$/, ''), source: 'github' };
}
await writeFile(resolve(outputDir, 'server.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Generated registry/server.json for ${parsed.origin}`);
