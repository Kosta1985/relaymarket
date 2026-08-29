import crypto from 'node:crypto';
import { VERSION } from './domain.js';

const buckets=new Map();
const WINDOW_MS=60_000;
const DEFAULT_LIMIT=Number(process.env.RELAYMARKET_RATE_LIMIT||120);

export function requestSource(req,url){
  const raw=req.headers['x-relaymarket-source']||url.searchParams.get('source')||'direct';
  const value=Array.isArray(raw)?raw[0]:raw;
  return String(value||'direct').toLowerCase().replace(/[^a-z0-9_.:-]/g,'').slice(0,80)||'direct';
}

export function idempotencyKey(req){
  const raw=req.headers['idempotency-key'];
  const key=Array.isArray(raw)?raw[0]:raw;
  if(!key)return null;
  const clean=String(key).trim();
  if(clean.length<8||clean.length>200)throw problem('invalid_idempotency_key',400);
  return clean;
}

export function requestFingerprint(method,path,body){
  return crypto.createHash('sha256').update(JSON.stringify({method,path,body})).digest('hex');
}

export function enforceRateLimit(req,scope='public',limit=DEFAULT_LIMIT){
  const ip=String(req.headers['cf-connecting-ip']||req.socket?.remoteAddress||'unknown');
  const key=`${scope}:${ip}`;const t=Date.now();let b=buckets.get(key);
  if(!b||t-b.startedAt>=WINDOW_MS)b={startedAt:t,count:0};
  b.count++;buckets.set(key,b);
  if(b.count>limit){const retry=Math.max(1,Math.ceil((WINDOW_MS-(t-b.startedAt))/1000));const e=problem('rate_limit_exceeded',429);e.retryAfter=retry;throw e;}
  return {limit,remaining:Math.max(0,limit-b.count),resetAt:new Date(b.startedAt+WINDOW_MS).toISOString()};
}

function problem(code,status){return Object.assign(new Error(code.replaceAll('_',' ')),{code,status})}

export function bearerToken(req){
  const raw=req.headers.authorization;const value=Array.isArray(raw)?raw[0]:raw;
  if(!value)return null;const m=String(value).match(/^Bearer\s+(.+)$/i);return m?m[1].trim():null;
}

export async function verifyOwnershipUrl(url,expectedToken){
  const u=new URL(url);if(u.protocol!=='https:')throw problem('verification_url_must_use_https',400);
  if(isPrivateHostLiteral(u.hostname))throw problem('verification_url_not_public',400);
  const { lookup }=await import('node:dns/promises');
  const addresses=await lookup(u.hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address)))throw problem('verification_url_not_public',400);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const r=await fetch(u,{method:'GET',redirect:'manual',signal:controller.signal,headers:{'user-agent':`RelayMarket-Ownership-Verifier/${VERSION}`}});
    if(r.status!==200)throw problem('verification_token_not_found',422);
    const text=(await r.text()).trim();if(text!==expectedToken)throw problem('verification_token_mismatch',422);return true;
  }catch(e){if(e?.code)throw e;throw problem('verification_fetch_failed',422)}finally{clearTimeout(timer)}
}

function isPrivateHostLiteral(host){return host==='localhost'||host.endsWith('.localhost')||isPrivateAddress(host)}
function isPrivateAddress(ip){
  if(/^127\./.test(ip)||/^10\./.test(ip)||/^192\.168\./.test(ip)||/^169\.254\./.test(ip)||ip==='::1'||ip==='0.0.0.0')return true;
  const m=ip.match(/^172\.(\d+)\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return true;
  if(/^fc/i.test(ip)||/^fd/i.test(ip)||/^fe8/i.test(ip)||/^fe9/i.test(ip)||/^fea/i.test(ip)||/^feb/i.test(ip))return true;
  return false;
}
