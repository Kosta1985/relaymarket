import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const originInput = String(process.env.PUBLIC_ORIGIN || '').trim();
if (!originInput) throw new Error('PUBLIC_ORIGIN is required, e.g. https://relaymarket.example');
const parsed = new URL(originInput);
if (parsed.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use https');
if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be an origin without path, query, or hash');
const origin = parsed.origin;
const googleToken = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();

const source = resolve('public');
const target = resolve('dist');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const indexPath = resolve(target, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html.replaceAll('__PUBLIC_ORIGIN__', origin);
if (googleToken) {
  html = html.replaceAll('__GOOGLE_SITE_VERIFICATION__', escapeHtmlAttribute(googleToken));
} else {
  html = html.replace(/\s*<meta name="google-site-verification" content="__GOOGLE_SITE_VERIFICATION__">\s*/g, '\n');
}
if (/__PUBLIC_ORIGIN__|__GOOGLE_SITE_VERIFICATION__/.test(html)) throw new Error('Unresolved deployment placeholder remains in built HTML');
await writeFile(indexPath, html);
console.log(`Built RelayMarket static portal for ${origin}`);

function escapeHtmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
