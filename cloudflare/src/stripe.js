const STRIPE_API = 'https://api.stripe.com/v1';

export async function stripeCreateConnectedAccount(secretKey,{country,email,idempotencyKey}={}){
  const body=new URLSearchParams();
  if(country)body.set('country',String(country).toUpperCase());
  if(email)body.set('email',String(email));
  body.set('controller[fees][payer]','application');
  body.set('controller[losses][payments]','application');
  body.set('controller[stripe_dashboard][type]','express');
  return stripePost(secretKey,'/accounts',body,idempotencyKey);
}

export async function stripeCreateAccountLink(secretKey,{account,refreshUrl,returnUrl,idempotencyKey}){
  const body=new URLSearchParams({account,type:'account_onboarding',refresh_url:refreshUrl,return_url:returnUrl});
  return stripePost(secretKey,'/account_links',body,idempotencyKey);
}

export async function stripeCreatePaymentIntent(secretKey,payment,{idempotencyKey}={}){
  const body=new URLSearchParams();
  body.set('amount',String(payment.payerTotalMinor));
  body.set('currency',String(payment.currency).toLowerCase());
  body.set('automatic_payment_methods[enabled]','true');
  body.set('transfer_group',`relaymarket_${payment.taskId}`);
  body.set('metadata[relaymarket_payment_id]',payment.id);
  body.set('metadata[relaymarket_task_id]',payment.taskId);
  body.set('metadata[relaymarket_platform_fee_bps]',String(payment.platformFeeBps));
  return stripePost(secretKey,'/payment_intents',body,idempotencyKey);
}

export async function stripeCreateTransfer(secretKey,{payment,destination,idempotencyKey}){
  const body=new URLSearchParams();
  body.set('amount',String(payment.amountMinor));
  body.set('currency',String(payment.currency).toLowerCase());
  body.set('destination',destination);
  body.set('transfer_group',`relaymarket_${payment.taskId}`);
  body.set('metadata[relaymarket_payment_id]',payment.id);
  body.set('metadata[relaymarket_task_id]',payment.taskId);
  return stripePost(secretKey,'/transfers',body,idempotencyKey);
}


export async function stripeCreateTransferReversal(secretKey,{transferId,idempotencyKey}){
  if(!transferId)throw problem('stripe_transfer_missing',409);
  return stripePost(secretKey,`/transfers/${encodeURIComponent(transferId)}/reversals`,new URLSearchParams(),idempotencyKey);
}

export async function stripeCreateRefund(secretKey,{paymentIntentId,idempotencyKey}){
  const body=new URLSearchParams({payment_intent:paymentIntentId});
  return stripePost(secretKey,'/refunds',body,idempotencyKey);
}

export async function verifyStripeWebhook(rawBody,signatureHeader,endpointSecret,{toleranceSeconds=300,nowSeconds=Math.floor(Date.now()/1000)}={}){
  if(!endpointSecret||!signatureHeader)throw problem('stripe_webhook_signature_missing',400);
  const parsed=parseSignature(signatureHeader),timestamp=Number(parsed.t?.[0]);
  if(!Number.isFinite(timestamp))throw problem('stripe_webhook_timestamp_invalid',400);
  if(Math.abs(nowSeconds-timestamp)>toleranceSeconds)throw problem('stripe_webhook_timestamp_outside_tolerance',400);
  const expected=await hmacSha256Hex(endpointSecret,`${timestamp}.${rawBody}`);
  const candidates=parsed.v1||[];
  if(!candidates.some(x=>constantTimeEqualHex(x,expected)))throw problem('stripe_webhook_signature_invalid',400);
  try{return JSON.parse(rawBody)}catch{throw problem('stripe_webhook_json_invalid',400)}
}

async function stripePost(secretKey,path,body,idempotencyKey){
  if(!secretKey||!String(secretKey).startsWith('sk_'))throw problem('stripe_secret_not_configured',503);
  const headers={'authorization':`Bearer ${secretKey}`,'content-type':'application/x-www-form-urlencoded'};
  if(idempotencyKey)headers['idempotency-key']=String(idempotencyKey).slice(0,255);
  const response=await fetch(`${STRIPE_API}${path}`,{method:'POST',headers,body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const message=data?.error?.message||`Stripe request failed (${response.status})`;throw Object.assign(new Error(message),{code:'stripe_api_error',status:502,stripeStatus:response.status,stripeType:data?.error?.type||null});}
  return data;
}

function parseSignature(header){const out={};for(const part of String(header).split(',')){const [k,v]=part.trim().split('=',2);if(!k||v==null)continue;(out[k]??=[]).push(v);}return out;}
async function hmacSha256Hex(secret,value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function constantTimeEqualHex(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function problem(code,status){return Object.assign(new Error(code.replaceAll('_',' ')),{code,status});}
