import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeCreateConnectedAccount,stripeCreateAccountLink,stripeCreatePaymentIntent,stripeCreateTransfer,stripeCreateTransferReversal,verifyStripeWebhook } from '../cloudflare/src/stripe.js';

function withFetch(fn){const original=globalThis.fetch;return async cb=>{globalThis.fetch=fn;try{return await cb();}finally{globalThis.fetch=original;}}}

test('Stripe adapter creates payment intent for payer total and preserves RelayMarket metadata',async()=>{
  await withFetch(async(url,init)=>{
    assert.equal(url,'https://api.stripe.com/v1/payment_intents');assert.equal(init.method,'POST');
    const body=new URLSearchParams(init.body);assert.equal(body.get('amount'),'101000');assert.equal(body.get('currency'),'aud');assert.equal(body.get('transfer_group'),'relaymarket_tsk_1');assert.equal(body.get('metadata[relaymarket_platform_fee_bps]'),'100');
    return Response.json({id:'pi_test',client_secret:'secret',status:'requires_payment_method'});
  })(async()=>{
    const out=await stripeCreatePaymentIntent('sk_test_123',{id:'pay_1',taskId:'tsk_1',payerTotalMinor:101000,currency:'AUD',platformFeeBps:100},{idempotencyKey:'pay-create-1'});assert.equal(out.id,'pi_test');
  });
});

test('Stripe Connect onboarding adapter uses application-paid fees and express dashboard controller',async()=>{
  let calls=0;
  await withFetch(async(url,init)=>{
    calls++;const body=new URLSearchParams(init.body);
    if(url.endsWith('/accounts')){assert.equal(body.get('controller[fees][payer]'),'application');assert.equal(body.get('controller[stripe_dashboard][type]'),'express');return Response.json({id:'acct_test'});}
    assert.equal(url,'https://api.stripe.com/v1/account_links');assert.equal(body.get('account'),'acct_test');assert.equal(body.get('type'),'account_onboarding');return Response.json({url:'https://connect.stripe.test/onboard'});
  })(async()=>{
    const account=await stripeCreateConnectedAccount('sk_test_123',{country:'AU'});const link=await stripeCreateAccountLink('sk_test_123',{account:account.id,refreshUrl:'https://relay.test/refresh',returnUrl:'https://relay.test/return'});assert.equal(link.url,'https://connect.stripe.test/onboard');
  });
  assert.equal(calls,2);
});

test('Stripe transfer sends the provider amount, not payer total',async()=>{
  await withFetch(async(url,init)=>{const body=new URLSearchParams(init.body);assert.equal(url,'https://api.stripe.com/v1/transfers');assert.equal(body.get('amount'),'100000');assert.equal(body.get('destination'),'acct_provider');return Response.json({id:'tr_test'});})(async()=>{
    const transfer=await stripeCreateTransfer('sk_test_123',{payment:{id:'pay_1',taskId:'tsk_1',amountMinor:100000,currency:'AUD'},destination:'acct_provider'});assert.equal(transfer.id,'tr_test');
  });
});



test('Stripe transfer reversal targets the released transfer and is idempotent',async()=>{
  await withFetch(async(url,init)=>{
    assert.equal(String(url),'https://api.stripe.com/v1/transfers/tr_123/reversals');
    assert.equal(init.headers['idempotency-key'],'reverse-payment-1');
    return Response.json({id:'trr_123'});
  })(async()=>{
    const reversal=await stripeCreateTransferReversal('sk_test_x',{transferId:'tr_123',idempotencyKey:'reverse-payment-1'});
    assert.equal(reversal.id,'trr_123');
  });
});


test('Stripe webhook verifier validates raw-body HMAC and timestamp tolerance',async()=>{
  const raw='{"id":"evt_1","type":"payment_intent.succeeded"}',secret='whsec_test',timestamp=1700000000;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex=[...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const event=await verifyStripeWebhook(raw,`t=${timestamp},v1=${hex}`,secret,{nowSeconds:timestamp});assert.equal(event.id,'evt_1');
  await assert.rejects(()=>verifyStripeWebhook(raw,`t=${timestamp},v1=deadbeef`,secret,{nowSeconds:timestamp}),/signature invalid/i);
});
