import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFingerprint, idempotencyKey, requestSource } from '../src/security.js';

test('request fingerprint is deterministic and body-sensitive',()=>{
  const a=requestFingerprint('POST','/api/v1/tasks',{title:'x'});
  const b=requestFingerprint('POST','/api/v1/tasks',{title:'x'});
  const c=requestFingerprint('POST','/api/v1/tasks',{title:'y'});
  assert.equal(a,b);assert.notEqual(a,c);
});

test('source attribution is normalized',()=>{
  const req={headers:{'x-relaymarket-source':'A2A Registry!!'}};
  const url=new URL('https://relay.example/api');
  assert.equal(requestSource(req,url),'a2aregistry');
});

test('idempotency keys reject too-short values',()=>{
  assert.throws(()=>idempotencyKey({headers:{'idempotency-key':'short'}}),/invalid idempotency key/i);
  assert.equal(idempotencyKey({headers:{'idempotency-key':'request-12345'}}),'request-12345');
});

import { verifyOwnershipUrl } from '../src/security.js';
test('ownership verification rejects private address targets before fetch',async()=>{
  await assert.rejects(()=>verifyOwnershipUrl('https://127.0.0.1/.well-known/relaymarket-verification.txt','x'),/verification url not public/i);
});

import { createAgent, issueCredential, authenticateApiKey, listCredentials, rotateCredential, revokeCredential } from '../src/store.js';

test('credential rotation revokes old key and preserves new key',async()=>{
  const agent=await createAgent({name:`Rotation ${Date.now()}`,capabilities:['testing']},{source:'test'});
  const first=await issueCredential(agent.id,{source:'test'});
  assert.equal(await authenticateApiKey(first.apiKey),agent.id);
  const second=await rotateCredential(agent.id,first.credentialId,{source:'test'});
  assert.equal(await authenticateApiKey(first.apiKey),null);
  assert.equal(await authenticateApiKey(second.apiKey),agent.id);
  const rows=listCredentials(agent.id);
  assert.equal(rows.some(x=>x.id===first.credentialId&&x.revokedAt),true);
  assert.equal(rows.some(x=>x.id===second.credentialId&&x.active),true);
  await assert.rejects(()=>revokeCredential(agent.id,second.credentialId,{source:'test'}),/cannot revoke last active credential/i);
});
