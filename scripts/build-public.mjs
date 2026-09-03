import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const originInput = String(process.env.PUBLIC_ORIGIN || '').trim();
if (!originInput) throw new Error('PUBLIC_ORIGIN is required, e.g. https://relaymarket.example');
const parsed = new URL(originInput);
if (parsed.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use https');
if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be an origin without path, query, or hash');
const origin = parsed.origin;
const googleToken = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));

const source = resolve('public');
const target = resolve('dist');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const indexPath = resolve(target, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html.replaceAll('__PUBLIC_ORIGIN__', origin);
if (!html.includes('href="/mobile.css"')) {
  html = html.replace('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css">\n  <link rel="stylesheet" href="/mobile.css" media="(max-width: 680px), (hover: none), (prefers-reduced-motion: reduce)">');
}
if (!html.includes('src="/analytics-bridge.js"')) {
  html = html.replace('<script type="module" src="/app.js"></script>', '<script src="/analytics-bridge.js"></script>\n  <script type="module" src="/app.js"></script>');
}
if (googleToken) {
  html = html.replaceAll('__GOOGLE_SITE_VERIFICATION__', escapeHtmlAttribute(googleToken));
} else {
  html = html.replace(/\s*<meta name="google-site-verification" content="__GOOGLE_SITE_VERIFICATION__">\s*/g, '\n');
}
if (/__PUBLIC_ORIGIN__|__GOOGLE_SITE_VERIFICATION__/.test(html)) throw new Error('Unresolved deployment placeholder remains in built HTML');
if (!html.includes('href="/mobile.css"')) throw new Error('TaskBay mobile hardening stylesheet was not linked into built HTML');
if (!html.includes('src="/analytics-bridge.js"')) throw new Error('TaskBay marketplace analytics bridge was not linked into built HTML');
await writeFile(indexPath, html);

await buildJsonDiscovery('.well-known/mcp.json', 'MCP discovery metadata');
await buildJsonDiscovery('.well-known/taskbay.json', 'TaskBay discovery metadata');
await buildTextDiscovery('agents.txt', 'TaskBay agent bootstrap');
await buildTextDiscovery('robots.txt', 'TaskBay robots policy');
await buildTextDiscovery('sitemap.xml', 'TaskBay sitemap');

console.log(`Built TaskBay static portal for ${origin}`);

async function buildJsonDiscovery(relativePath, label) {
  const path = resolve(target, relativePath);
  let content = await readFile(path, 'utf8');
  content = substitutePublicMetadata(content);
  if (/__PUBLIC_ORIGIN__|__RELAYMARKET_VERSION__/.test(content)) throw new Error(`Unresolved deployment placeholder remains in built ${label}`);
  JSON.parse(content);
  await writeFile(path, content);
}

async function buildTextDiscovery(relativePath, label) {
  const path = resolve(target, relativePath);
  let content = await readFile(path, 'utf8');
  content = substitutePublicMetadata(content);
  if (/__PUBLIC_ORIGIN__|__RELAYMARKET_VERSION__/.test(content)) throw new Error(`Unresolved deployment placeholder remains in built ${label}`);
  await writeFile(path, content);
}

function substitutePublicMetadata(content) {
  return content
    .replaceAll('__PUBLIC_ORIGIN__', origin)
    .replaceAll('__RELAYMARKET_VERSION__', pkg.version);
}

function escapeHtmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
