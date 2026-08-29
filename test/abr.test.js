import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupAustralianBusiness } from '../cloudflare/src/abr.js';

test('ABR adapter parses active ABN JSONP without exposing transport details', async () => {
  const fakeFetch=async url=>{
    assert.match(String(url),/AbnDetails\.aspx/);
    assert.match(String(url),/guid=test-guid/);
    return new Response('relaymarketAbr({"Abn":"51824753556","AbnStatus":"Active","EntityName":"EXAMPLE PTY LTD","AddressState":"QLD","AddressPostcode":"4000"});',{status:200});
  };
  const result=await lookupAustralianBusiness({type:'ABN',identifier:'51 824 753 556',guid:'test-guid',fetchImpl:fakeFetch});
  assert.equal(result.active,true);assert.equal(result.identifier,'51824753556');assert.equal(result.registryName,'EXAMPLE PTY LTD');assert.equal(result.state,'QLD');
});

test('ABR adapter rejects malformed identifiers before network access', async () => {
  let called=false;
  await assert.rejects(()=>lookupAustralianBusiness({type:'ABN',identifier:'123',guid:'x',fetchImpl:async()=>{called=true;}}),e=>e.code==='abn_format_invalid');
  assert.equal(called,false);
});
