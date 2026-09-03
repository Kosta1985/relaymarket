import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const originInput = String(process.env.PUBLIC_ORIGIN || '').trim();
if (!originInput) throw new Error('PUBLIC_ORIGIN is required, e.g. https://taskbay.example');
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
if (!html.includes('href="/header-clean.css"')) {
  html = html.replace('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css">\n  <link rel="stylesheet" href="/header-clean.css">');
}
if (!html.includes('href="/early-access.css"')) {
  html = html.replace('<link rel="stylesheet" href="/header-clean.css">', '<link rel="stylesheet" href="/header-clean.css">\n  <link rel="stylesheet" href="/early-access.css">');
}
if (!html.includes('href="/empty-states.css"')) {
  html = html.replace('<link rel="stylesheet" href="/early-access.css">', '<link rel="stylesheet" href="/early-access.css">\n  <link rel="stylesheet" href="/empty-states.css">');
}
if (!html.includes('src="/analytics-bridge.js"')) {
  html = html.replace('<script type="module" src="/app.js"></script>', '<script src="/analytics-bridge.js"></script>\n  <script type="module" src="/app.js"></script>');
}
if (!html.includes('src="/site-copy.js"')) {
  html = html.replace('<script src="/analytics-bridge.js"></script>', '<script src="/site-copy.js"></script>\n  <script src="/analytics-bridge.js"></script>');
}
if (!html.includes('src="/public-cleanup.js"')) {
  html = html.replace('<script src="/site-copy.js"></script>', '<script src="/public-cleanup.js"></script>\n  <script src="/site-copy.js"></script>');
}
if (!html.includes('src="/market-state.js"')) {
  html = html.replace('<script src="/analytics-bridge.js"></script>', '<script src="/market-state.js"></script>\n  <script src="/analytics-bridge.js"></script>');
}
if (!html.includes('src="/empty-states.js"')) {
  html = html.replace('<script src="/market-state.js"></script>', '<script src="/empty-states.js"></script>\n  <script src="/market-state.js"></script>');
}
if (googleToken) {
  html = html.replaceAll('__GOOGLE_SITE_VERIFICATION__', escapeHtmlAttribute(googleToken));
} else {
  html = html.replace(/\s*<meta name="google-site-verification" content="__GOOGLE_SITE_VERIFICATION__">\s*/g, '\n');
}
if (/__PUBLIC_ORIGIN__|__GOOGLE_SITE_VERIFICATION__/.test(html)) throw new Error('Unresolved deployment placeholder remains in built HTML');
if (!html.includes('href="/mobile.css"')) throw new Error('TaskBay mobile hardening stylesheet was not linked into built HTML');
if (!html.includes('href="/header-clean.css"')) throw new Error('TaskBay professional visual stylesheet was not linked into built HTML');
if (!html.includes('href="/early-access.css"')) throw new Error('TaskBay early-access stylesheet was not linked into built HTML');
if (!html.includes('href="/empty-states.css"')) throw new Error('TaskBay polished empty-state stylesheet was not linked into built HTML');
if (!html.includes('src="/public-cleanup.js"')) throw new Error('TaskBay legacy-brand cleanup was not linked into built HTML');
if (!html.includes('src="/site-copy.js"')) throw new Error('TaskBay simplified product copy was not linked into built HTML');
if (!html.includes('src="/empty-states.js"')) throw new Error('TaskBay polished empty-state UX was not linked into built HTML');
if (!html.includes('src="/market-state.js"')) throw new Error('TaskBay early-access market state was not linked into built HTML');
if (!html.includes('src="/analytics-bridge.js"')) throw new Error('TaskBay marketplace analytics bridge was not linked into built HTML');
if (!/<title>TaskBay\b/i.test(html)) throw new Error('TaskBay page title is missing from built HTML');
if (!/class="brand-word">TaskBay</i.test(html)) throw new Error('TaskBay header brand is missing from built HTML');
await writeFile(indexPath, html);

await buildHtmlDiscovery('join.html', 'TaskBay agent join landing page');
await buildHtmlDiscovery('integrations.html', 'TaskBay ecosystem integrations landing page');
await buildJsonDiscovery('.well-known/mcp.json', 'MCP discovery metadata');
await buildJsonDiscovery('.well-known/taskbay.json', 'TaskBay discovery metadata');
await buildJsonDiscovery('onboard.json', 'TaskBay autonomous onboarding contract');
await buildJsonDiscovery('ecosystems.json', 'TaskBay ecosystem acquisition catalog');
await buildTextDiscovery('agents.txt', 'TaskBay agent bootstrap');
await buildTextDiscovery('invite.txt', 'TaskBay machine-forwardable invitation');
await buildTextDiscovery('verify.txt', 'TaskBay endpoint verification rescue guide');
await buildTextDiscovery('frameworks.txt', 'TaskBay framework acquisition routes');
await buildTextDiscovery('llms.txt', 'TaskBay LLM discovery entrypoint');
await buildTextDiscovery('llms-full.txt', 'TaskBay full LLM integration guide');
await buildTextDiscovery('robots.txt', 'TaskBay robots policy');
await buildTextDiscovery('sitemap.xml', 'TaskBay sitemap');

console.log(`Built TaskBay static portal for ${origin}`);

async function buildHtmlDiscovery(relativePath, label) {
  const path = resolve(target, relativePath);
  let content = await readFile(path, 'utf8');
  content = substitutePublicMetadata(content);
  if (hasUnresolvedPublicMetadata(content)) throw new Error(`Unresolved deployment placeholder remains in built ${label}`);
  await writeFile(path, content);
}

async function buildJsonDiscovery(relativePath, label) {
  const path = resolve(target, relativePath);
  let content = await readFile(path, 'utf8');
  content = substitutePublicMetadata(content);
  if (hasUnresolvedPublicMetadata(content)) throw new Error(`Unresolved deployment placeholder remains in built ${label}`);
  JSON.parse(content);
  await writeFile(path, content);
}

async function buildTextDiscovery(relativePath, label) {
  const path = resolve(target, relativePath);
  let content = await readFile(path, 'utf8');
  content = substitutePublicMetadata(content);
  if (hasUnresolvedPublicMetadata(content)) throw new Error(`Unresolved deployment placeholder remains in built ${label}`);
  await writeFile(path, content);
}

function substitutePublicMetadata(content) {
  return content
    .replaceAll('__PUBLIC_ORIGIN__', origin)
    .replaceAll('__TASKBAY_VERSION__', pkg.version)
    .replaceAll('__RELAYMARKET_VERSION__', pkg.version);
}

function hasUnresolvedPublicMetadata(content) {
  return /__PUBLIC_ORIGIN__|__TASKBAY_VERSION__|__RELAYMARKET_VERSION__/.test(content);
}

function escapeHtmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
