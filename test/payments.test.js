import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_FEE_BPS, paymentQuote, paymentTransitionAllowed } from '../src/payments.js';

test('TaskBay platform fee is exactly 1 percent in basis points',()=>{
  assert.equal(PLATFORM_FEE_BPS,100);
  const q=paymentQuote(100000,'AUD');
  assert.equal(q.providerAmountMinor,100000);
  assert.equal(q.platformFeeMinor,1000);
  assert.equal(q.payerTotalMinor,101000);
  assert.equal(q.currency,'AUD');
});

test('payment calculations stay in integer minor units with no minimum platform fee',()=>{
  assert.equal(paymentQuote(1,'USD').platformFeeMinor,0);
  assert.equal(paymentQuote(50,'USD').platformFeeMinor,0);
  assert.equal(paymentQuote(100,'USD').platformFeeMinor,1);
  assert.equal(paymentQuote(199,'USD').platformFeeMinor,1);
  assert.throws(()=>paymentQuote(1.5,'USD'),/invalid amount minor/i);
});

test('payment lifecycle only allows controlled transitions',()=>{
  assert.equal(paymentTransitionAllowed('created','funded'),true);
  assert.equal(paymentTransitionAllowed('funded','released'),true);
  assert.equal(paymentTransitionAllowed('released','refunded'),true);
});
