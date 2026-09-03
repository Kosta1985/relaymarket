import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../cloudflare/src/index.js';

class SQLiteD1 {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql){this.db.exec(sql);}
  prepare(sql){return new SQLiteStmt(this.db,sql);}
  async batch(stmts){const out=[];this.db.exec('BEGIN IMMEDIATE');try{for(const s of stmts)out.push(await s._exec());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
class SQLiteStmt {
  constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
  bind(...args){return new SQLiteStmt(this.db,this.sql,args);}
  async all(){const rows=this.db.prepare(this.sql).all(...this.args);return{results:rows,success:true,meta:{changes:0}};}
  async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
  async run(){const r=this.db.prepare(this.sql).run(...this.args);return{success:true,meta:{changes:Number(r.changes||0),last_row_id:r.lastInsertRowid}};}
  async _exec(){if(/^\s*(select|pragma|with)\b/i.test(this.sql))return this.all();return this.run();}
}

async function env(overrides={}){const DB=new SQLiteD1();DB.exec(await readFile(new URL('../cloudflare/migrations/0001_relaymarket.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0002_payments.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0003_trust_safety.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0004_operator_verification.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0005_payment_protection.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0006_risk_holds.sql',import.meta.url),'utf8'));DB.exec(await readFile(new URL('../cloudflare/migrations/0007_requester_provider_loop.sql',import.meta.url),'utf8'));return{DB,ASSETS:{fetch:async()=>new Response('asset',{status:200})},...overrides};}
async function api(env,path,init={}){const r=await worker.fetch(new Request(`https://relaymarket.test${path}`,{...init,headers:{'content-type':'application/json','x-relaymarket-source':'edge-test',...(init.headers||{})}}),env);let body=null;const text=await r.text();if(text)body=JSON.parse(text);return{r,body};}

test('D1 edge registration, idempotency and lifecycle counters remain consistent',async()=>{
  const e=await env();
  const first=await api(e,'/api/v1/agents',{method:'POST',headers:{'idempotency-key':'register-requester-001'},body:JSON.stringify({id:'agt_requester_edge',name:'Requester Edge',capabilities:['planning'],protocols:['mcp']})});
  assert.equal(first.r.status,201);assert.match(first.body.credential.apiKey,/^rmk_/);
  const replay=await api(e,'/api/v1/agents',{method:'POST',headers:{'idempotency-key':'register-requester-001'},body:JSON.stringify({id:'agt_requester_edge',name:'Requester Edge',capabilities:['planning'],protocols:['mcp']})});
  assert.equal(replay.r.status,201);assert.equal(replay.r.headers.get('x-idempotent-replay'),'true');
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_provider_edge',name:'Provider Edge',capabilities:['research'],protocols:['mcp']})});
  assert.equal(provider.r.status,201);
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${first.body.credential.apiKey}`,'idempotency-key':'task-create-edge-001'},body:JSON.stringify({title:'Edge task',description:'D1 lifecycle',requesterAgentId:'agt_requester_edge',requiredCapabilities:['research'],preferredProtocols:['mcp']})});
  assert.equal(task.r.status,201);
  const taskId=task.body.task.id;
  const accept=await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_provider_edge'})});assert.equal(accept.r.status,200);
  const start=await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_provider_edge'})});assert.equal(start.r.status,200);
  const deliver=await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_provider_edge',artifact:{result:'done'}})});assert.equal(deliver.r.status,200);assert.match(deliver.body.task.artifactDigest,/^[a-f0-9]{64}$/);
  const complete=await api(e,`/api/v1/tasks/${taskId}/complete`,{method:'POST',headers:{authorization:`Bearer ${first.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_requester_edge',rating:5,comment:'good'})});assert.equal(complete.r.status,200);
  const stats=await api(e,'/api/v1/stats');assert.equal(stats.body.agents,2);assert.equal(stats.body.completedTasks,1);assert.equal(stats.body.counters['agent.registered'],2);assert.equal(stats.body.counters['agent.credential_issued'],2);assert.equal(stats.body.counters['task.created'],1);assert.equal(stats.body.counters['task.accepted'],1);assert.equal(stats.body.counters['task.started'],1);assert.equal(stats.body.counters['task.delivered'],1);assert.equal(stats.body.counters['task.completed'],1);
});

test('D1 idempotency rejects key reuse with a different request',async()=>{
  const e=await env();
  const key='same-idempotency-key-001';
  const a=await api(e,'/api/v1/agents',{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({id:'agt_idem_one',name:'One'})});assert.equal(a.r.status,201);
  const b=await api(e,'/api/v1/agents',{method:'POST',headers:{'idempotency-key':key},body:JSON.stringify({id:'agt_idem_two',name:'Two'})});assert.equal(b.r.status,409);assert.equal(b.body.error,'idempotency_key_reused_with_different_request');
  const stats=await api(e,'/api/v1/stats');assert.equal(stats.body.agents,1);assert.equal(stats.body.counters['agent.registered'],1);
});

test('D1 edge MCP initialize and tools/list are live',async()=>{
  const e=await env();
  const init=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});assert.equal(init.r.status,200);assert.equal(init.body.result.serverInfo.name,'relaymarket');
  const tools=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});assert.equal(tools.r.status,200);assert.ok(tools.body.result.tools.some(x=>x.name==='relaymarket_publish_task'));
});

test('D1 verification challenge stores only a token hash',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_verify_edge',name:'Verify Edge',endpoints:[{protocol:'mcp',url:'https://example.com/mcp'}]})});
  const key=a.body.credential.apiKey;
  const c=await api(e,'/api/v1/agents/agt_verify_edge/verification-challenges',{method:'POST',headers:{authorization:`Bearer ${key}`,'idempotency-key':'verification-create-001'},body:JSON.stringify({endpointIndex:0})});
  assert.equal(c.r.status,201);assert.match(c.body.challenge.token,/^rm_verify_/);
  const row=e.DB.db.prepare('SELECT token_hash,event_source FROM agent_verification_challenges WHERE id=?').get(c.body.challenge.id);
  assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.notEqual(row.token_hash,c.body.challenge.token);assert.equal(row.event_source,'edge-test');
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['agent.verification_challenge_created'],1);
});

test('D1 repeat-provider metric increments only after the second completion',async()=>{
  const e=await env();
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_repeat_requester',name:'Repeat Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_repeat_provider',name:'Repeat Provider',capabilities:['research']})});
  async function runTask(suffix){
    const t=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:`Task ${suffix}`,requesterAgentId:'agt_repeat_requester',requiredCapabilities:['research']})});
    const id=t.body.task.id;
    await api(e,`/api/v1/tasks/${id}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_repeat_provider'})});
    await api(e,`/api/v1/tasks/${id}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_repeat_provider'})});
    await api(e,`/api/v1/tasks/${id}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_repeat_provider',artifact:{ok:true}})});
    await api(e,`/api/v1/tasks/${id}/complete`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_repeat_requester'})});
  }
  await runTask('one');let stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['provider.repeat_completion']||0,0);
  await runTask('two');stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.repeatProviders,1);assert.equal(stats.counters['provider.repeat_completion'],1);
});


test('edge discovery endpoints and portal canonical rewrite are deploy-ready',async()=>{
  const e=await env();
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  e.PUBLIC_ORIGIN='https://relaymarket.example';
  e.GOOGLE_SITE_VERIFICATION='google-token-test';
  e.ASSETS={fetch:async req=>new URL(req.url).pathname==='/index.html'?new Response(html,{status:200,headers:{'content-type':'text/html'}}):new Response('asset',{status:200})};

  const card=await api(e,'/.well-known/agent-card.json');
  assert.equal(card.r.status,200);assert.equal(card.body.protocolVersion,'0.3.0');assert.equal(card.body.supportedInterfaces[0].protocolVersion,'0.3');
  const alias=await api(e,'/.well-known/agent.json');assert.equal(alias.r.status,200);assert.equal(alias.body.name,'TaskBay');
  const server=await api(e,'/server.json');assert.equal(server.body.name,'io.github.Kosta1985/relaymarket');assert.equal(server.body.remotes[0].url,'https://relaymarket.example/mcp');

  const rootResponse=await worker.fetch(new Request('https://worker.invalid/'),e);
  const root=await rootResponse.text();
  assert.equal(rootResponse.status,200);assert.match(root,/https:\/\/relaymarket\.example\//);assert.match(root,/google-token-test/);assert.doesNotMatch(root,/__PUBLIC_ORIGIN__|__GOOGLE_SITE_VERIFICATION__/);

  const robotsResponse=await worker.fetch(new Request('https://worker.invalid/robots.txt'),e);
  const robots=await robotsResponse.text();assert.match(robots,/Sitemap: https:\/\/relaymarket\.example\/sitemap\.xml/);
  const sitemapResponse=await worker.fetch(new Request('https://worker.invalid/sitemap.xml'),e);
  const sitemap=await sitemapResponse.text();assert.match(sitemap,/<loc>https:\/\/relaymarket\.example\/<\/loc>/);
  const llmsResponse=await worker.fetch(new Request('https://worker.invalid/llms.txt'),e);
  const llms=await llmsResponse.text();assert.match(llms,/https:\/\/relaymarket\.example\/mcp/);
});

test('MCP transport advertises supported legacy revision and rejects GET',async()=>{
  const e=await env();
  const get=await worker.fetch(new Request('https://relaymarket.test/mcp'),e);assert.equal(get.status,405);assert.equal(get.headers.get('allow'),'POST');
  const discover=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:7,method:'server/discover',params:{}})});
  assert.equal(discover.r.status,200);assert.deepEqual(discover.body.result.supportedVersions,['2025-11-25']);
  const init=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:8,method:'initialize',params:{}})});
  assert.equal(init.body.result.protocolVersion,'2025-11-25');
});

test('A2A 0.3 response includes task context, artifact id and discriminators',async()=>{
  const e=await env();
  const call=await api(e,'/a2a',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:11,method:'message/send',params:{message:{messageId:'msg-1',role:'user',parts:[{kind:'data',data:{action:'discover_agents'}}]}}})});
  assert.equal(call.r.status,200);assert.equal(call.body.result.kind,'task');assert.ok(call.body.result.contextId);assert.equal(call.body.result.status.state,'completed');assert.ok(call.body.result.artifacts[0].artifactId);assert.equal(call.body.result.artifacts[0].parts[0].kind,'data');
});

test('D1 credential rotation atomically revokes the old credential and activates the new one',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_rotate_edge',name:'Rotate Edge'})});
  const oldKey=a.body.credential.apiKey,oldId=a.body.credential.credentialId;
  const rotated=await api(e,`/api/v1/agents/agt_rotate_edge/credentials/${oldId}/rotate`,{method:'POST',headers:{authorization:`Bearer ${oldKey}`,'idempotency-key':'rotate-edge-0001'},body:'{}'});
  assert.equal(rotated.r.status,201);const newKey=rotated.body.credential.apiKey;assert.notEqual(newKey,oldKey);
  const oldAuth=await e.DB.prepare('SELECT revoked_at FROM agent_credentials WHERE id=?').bind(oldId).first();assert.ok(oldAuth.revoked_at);
  const oldUse=await api(e,'/api/v1/agents/agt_rotate_edge/credentials',{headers:{authorization:`Bearer ${oldKey}`}});assert.equal(oldUse.r.status,401);
  const newUse=await api(e,'/api/v1/agents/agt_rotate_edge/credentials',{headers:{authorization:`Bearer ${newKey}`}});assert.equal(newUse.r.status,200);assert.ok(newUse.body.credentials.some(x=>x.active));
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['agent.credential_issued'],2);assert.equal(stats.counters['agent.credential_rotated'],1);
});

test('D1 endpoint ownership verification marks only the challenged agent and counts once',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_verify_complete',name:'Verify Complete',endpoints:[{protocol:'mcp',url:'https://agent.example/mcp'}]})});
  const key=a.body.credential.apiKey;
  const c=await api(e,'/api/v1/agents/agt_verify_complete/verification-challenges',{method:'POST',headers:{authorization:`Bearer ${key}`,'idempotency-key':'verification-complete-create'},body:JSON.stringify({endpointIndex:0})});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async request=>{
    const u=typeof request==='string'?request:(request?.url||String(request));
    assert.equal(u,'https://agent.example/.well-known/relaymarket-verification.txt');
    return new Response(c.body.challenge.token,{status:200,headers:{'content-type':'text/plain'}});
  };
  try{
    const verified=await api(e,`/api/v1/agents/agt_verify_complete/verification-challenges/${c.body.challenge.id}/verify`,{method:'POST',headers:{authorization:`Bearer ${key}`,'idempotency-key':'verification-complete-verify'},body:'{}'});
    assert.equal(verified.r.status,200,JSON.stringify(verified.body));assert.equal(verified.body.agent.verified,true);
    const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['agent.endpoint_verified'],1);
  } finally { globalThis.fetch=originalFetch; }
});

test('MCP can execute the complete authenticated marketplace lifecycle with retry-safe publish',async()=>{
  const e=await env();
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_mcp_requester',name:'MCP Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_mcp_provider',name:'MCP Provider',capabilities:['analysis'],protocols:['mcp']})});
  async function tool(id,name,args,token,key){
    return api(e,'/mcp',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(key?{'idempotency-key':key}:{})},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})});
  }
  const publishArgs={title:'MCP lifecycle',description:'End to end via MCP',requesterAgentId:'agt_mcp_requester',requiredCapabilities:['analysis'],preferredProtocols:['mcp']};
  const pub=await tool(1,'relaymarket_publish_task',publishArgs,requester.body.credential.apiKey,'mcp-publish-0001');assert.equal(pub.r.status,200);
  const taskId=pub.body.result.structuredContent.task.id;
  const replay=await tool(2,'relaymarket_publish_task',publishArgs,requester.body.credential.apiKey,'mcp-publish-0001');assert.equal(replay.body.result.structuredContent.task.id,taskId);
  assert.equal((await api(e,'/api/v1/tasks?status=all')).body.tasks.filter(x=>x.title==='MCP lifecycle').length,1);
  assert.equal((await tool(3,'relaymarket_accept_task',{taskId,providerAgentId:'agt_mcp_provider'},provider.body.credential.apiKey,'mcp-accept-0001')).body.result.structuredContent.task.status,'accepted');
  assert.equal((await tool(4,'relaymarket_start_task',{taskId,providerAgentId:'agt_mcp_provider'},provider.body.credential.apiKey,'mcp-start-0001')).body.result.structuredContent.task.status,'working');
  const msg=await tool(5,'relaymarket_send_message',{taskId,fromAgentId:'agt_mcp_provider',toAgentId:'agt_mcp_requester',type:'note',body:'Working through MCP'},provider.body.credential.apiKey,'mcp-message-0001');assert.equal(msg.body.result.structuredContent.message.body,'Working through MCP');
  const delivered=await tool(6,'relaymarket_deliver_task',{taskId,providerAgentId:'agt_mcp_provider',artifact:{answer:42},note:'done'},provider.body.credential.apiKey,'mcp-deliver-0001');assert.equal(delivered.body.result.structuredContent.task.status,'delivered');
  const completed=await tool(7,'relaymarket_complete_task',{taskId,requesterAgentId:'agt_mcp_requester',rating:5,comment:'solid'},requester.body.credential.apiKey,'mcp-complete-0001');assert.equal(completed.body.result.structuredContent.task.status,'completed');
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['task.created'],1);assert.equal(stats.counters['task.completed'],1);assert.equal(stats.counters['task.message'],1);
});

test('A2A can execute the complete authenticated marketplace lifecycle with retry-safe publish',async()=>{
  const e=await env();
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_a2a_requester',name:'A2A Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_a2a_provider',name:'A2A Provider',capabilities:['translation'],protocols:['a2a']})});
  async function action(id,data,token,key){
    return api(e,'/a2a',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(key?{'idempotency-key':key}:{})},body:JSON.stringify({jsonrpc:'2.0',id,method:'message/send',params:{message:{messageId:`msg-${id}`,role:'user',parts:[{kind:'data',data}]}}})});
  }
  const task={title:'A2A lifecycle',description:'End to end via A2A',requesterAgentId:'agt_a2a_requester',requiredCapabilities:['translation'],preferredProtocols:['a2a']};
  const pub=await action(1,{action:'publish_task',task},requester.body.credential.apiKey,'a2a-publish-0001');assert.equal(pub.r.status,200);
  const taskId=pub.body.result.artifacts[0].parts[0].data.task.id;
  const replay=await action(2,{action:'publish_task',task},requester.body.credential.apiKey,'a2a-publish-0001');assert.equal(replay.body.result.artifacts[0].parts[0].data.task.id,taskId);
  assert.equal((await api(e,'/api/v1/tasks?status=all')).body.tasks.filter(x=>x.title==='A2A lifecycle').length,1);
  assert.equal((await action(3,{action:'accept_task',taskId,providerAgentId:'agt_a2a_provider'},provider.body.credential.apiKey,'a2a-accept-0001')).body.result.artifacts[0].parts[0].data.task.status,'accepted');
  assert.equal((await action(4,{action:'start_task',taskId,providerAgentId:'agt_a2a_provider'},provider.body.credential.apiKey,'a2a-start-0001')).body.result.artifacts[0].parts[0].data.task.status,'working');
  const msg=await action(5,{action:'send_message',taskId,fromAgentId:'agt_a2a_provider',toAgentId:'agt_a2a_requester',type:'note',body:'Working through A2A'},provider.body.credential.apiKey,'a2a-message-0001');assert.equal(msg.body.result.artifacts[0].parts[0].data.message.body,'Working through A2A');
  const delivered=await action(6,{action:'deliver_task',taskId,providerAgentId:'agt_a2a_provider',artifact:{answer:'translated'},note:'done'},provider.body.credential.apiKey,'a2a-deliver-0001');assert.equal(delivered.body.result.artifacts[0].parts[0].data.task.status,'delivered');
  const completed=await action(7,{action:'complete_task',taskId,requesterAgentId:'agt_a2a_requester',rating:5,comment:'solid'},requester.body.credential.apiKey,'a2a-complete-0001');assert.equal(completed.body.result.artifacts[0].parts[0].data.task.status,'completed');
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['task.created'],1);assert.equal(stats.counters['task.completed'],1);assert.equal(stats.counters['task.message'],1);
});


test('D1 payment foundation uses a 1% fee, blocks work until funded, and records financial counters',async()=>{
  const e=await env({PAYMENT_PROVIDER:'mock'});
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_pay_requester',name:'Pay Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_pay_provider',name:'Pay Provider',capabilities:['coding']})});
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Paid task',description:'Payment test',requesterAgentId:'agt_pay_requester',requiredCapabilities:['coding']})});
  const taskId=task.body.task.id;
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_pay_provider'})})).r.status,200);
  const created=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'payment-create-0001'},body:JSON.stringify({requesterAgentId:'agt_pay_requester',amountMinor:100000,currency:'AUD'})});
  assert.equal(created.r.status,201,JSON.stringify(created.body));
  assert.equal(created.body.payment.platformFeeBps,100);assert.equal(created.body.payment.platformFeeMinor,1000);assert.equal(created.body.payment.payerTotalMinor,101000);
  const blocked=await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_pay_provider'})});assert.equal(blocked.r.status,409);assert.equal(blocked.body.error,'payment_not_funded');
  const paymentId=created.body.payment.id;
  const funded=await api(e,`/api/v1/payments/${paymentId}/mock/fund`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({actorAgentId:'agt_pay_requester',providerReference:'mock_charge_1'})});assert.equal(funded.r.status,200);assert.equal(funded.body.payment.status,'funded');
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_pay_provider'})})).r.status,200);
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_pay_provider',artifact:{ok:true}})})).r.status,200);
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/complete`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_pay_requester'})})).r.status,200);
  const released=await api(e,`/api/v1/payments/${paymentId}/mock/release`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({actorAgentId:'agt_pay_requester'})});assert.equal(released.r.status,200);assert.equal(released.body.payment.status,'released');
  const financials=(await api(e,'/api/v1/payments/stats')).body;assert.equal(financials.platformFeeBps,100);assert.equal(financials.byCurrency.AUD.gmvMinor,100000);assert.equal(financials.byCurrency.AUD.platformRevenueMinor,1000);assert.equal(financials.byCurrency.AUD.providerPayoutMinor,100000);
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['payment.created'],1);assert.equal(stats.counters['payment.funded'],1);assert.equal(stats.counters['payment.released'],1);
});

test('D1 production payment mode is disabled by default instead of pretending payments are live',async()=>{
  const e=await env();
  const config=(await api(e,'/api/v1/payments/config')).body;assert.equal(config.provider,'disabled');assert.equal(config.live,false);assert.equal(config.platformFeeBps,100);
  const quote=(await api(e,'/api/v1/payments/quote?amountMinor=12345&currency=AUD')).body.quote;assert.equal(quote.platformFeeMinor,123);assert.equal(quote.payerTotalMinor,12468);
});

test('Stripe provider stays fail-closed until secret, webhook and processor policy are all configured',async()=>{
  const e=await env({PAYMENT_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_incomplete'});
  const config=(await api(e,'/api/v1/payments/config')).body;
  assert.equal(config.provider,'stripe');assert.equal(config.live,false);assert.equal(config.readiness.secretConfigured,true);assert.equal(config.readiness.webhookConfigured,false);assert.equal(config.readiness.processorPolicyConfigured,false);
});

async function stripeSignature(raw,secret,timestamp=Math.floor(Date.now()/1000)){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex=[...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function stripeWebhook(e,event,secret='whsec_edge'){
  const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),signature=await stripeSignature(raw,secret,timestamp);
  const r=await worker.fetch(new Request('https://relaymarket.test/webhooks/stripe',{method:'POST',headers:{'stripe-signature':signature,'content-type':'application/json'},body:raw}),e);
  const text=await r.text();return{r,body:text?JSON.parse(text):null};
}

test('Stripe-mode D1 flow onboards provider, funds by signed webhook, and releases provider amount only after completion',async()=>{
  const e=await env({PAYMENT_PROVIDER:'stripe',PAYMENT_PROCESSOR_COST_POLICY:'platform_absorbs',STRIPE_SECRET_KEY:'sk_test_edge',STRIPE_WEBHOOK_SECRET:'whsec_edge'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const u=String(url),body=new URLSearchParams(init.body||'');
    if(u.endsWith('/v1/accounts')) return Response.json({id:'acct_edge_provider',country:'AU',charges_enabled:false,payouts_enabled:false,details_submitted:false});
    if(u.endsWith('/v1/account_links')) return Response.json({url:'https://connect.stripe.test/onboard',expires_at:1700000300});
    if(u.endsWith('/v1/payment_intents')){assert.equal(body.get('amount'),'101000');assert.equal(body.get('currency'),'aud');return Response.json({id:'pi_edge_1',client_secret:'pi_edge_1_secret',status:'requires_payment_method'});}
    if(u.endsWith('/v1/transfers')){assert.equal(body.get('amount'),'100000');assert.equal(body.get('destination'),'acct_edge_provider');return Response.json({id:'tr_edge_1'});}
    if(u.endsWith('/v1/transfers/tr_edge_1/reversals')) return Response.json({id:'trr_edge_1'});
    if(u.endsWith('/v1/refunds')){assert.equal(body.get('payment_intent'),'pi_edge_1');return Response.json({id:'re_edge_1',status:'succeeded'});}
    throw new Error(`Unexpected Stripe URL ${u}`);
  };
  try{
    const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_stripe_requester',name:'Stripe Requester'})});
    const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_stripe_provider',name:'Stripe Provider',capabilities:['coding']})});
    const onboard=await api(e,'/api/v1/agents/agt_stripe_provider/payout/stripe/onboard',{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({country:'AU'})});
    assert.equal(onboard.r.status,200,JSON.stringify(onboard.body));assert.equal(onboard.body.payoutAccount.externalAccountId,'acct_edge_provider');assert.match(onboard.body.onboardingUrl,/connect\.stripe/);
    const accountEvent={id:'evt_account',type:'account.updated',data:{object:{id:'acct_edge_provider',country:'AU',charges_enabled:true,payouts_enabled:true,details_submitted:true}}};
    const accountHook=await stripeWebhook(e,accountEvent);assert.equal(accountHook.r.status,200,JSON.stringify(accountHook.body));
    const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Stripe paid task',description:'real provider boundary test',requesterAgentId:'agt_stripe_requester',requiredCapabilities:['coding']})});
    const taskId=task.body.task.id;
    assert.equal((await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_stripe_provider'})})).r.status,200);
    const payment=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'stripe-payment-edge-0001'},body:JSON.stringify({requesterAgentId:'agt_stripe_requester',amountMinor:100000,currency:'AUD'})});
    assert.equal(payment.r.status,201,JSON.stringify(payment.body));assert.equal(payment.body.payment.provider,'stripe');assert.equal(payment.body.payment.providerReference,'pi_edge_1');assert.equal(payment.body.providerSession.clientSecret,'pi_edge_1_secret');
    const paymentId=payment.body.payment.id;
    const mismatchedEvent={id:'evt_pi',type:'payment_intent.succeeded',data:{object:{id:'pi_edge_1',amount_received:99999,currency:'aud',metadata:{relaymarket_payment_id:paymentId}}}};
    const mismatchHook=await stripeWebhook(e,mismatchedEvent);assert.equal(mismatchHook.r.status,409,JSON.stringify(mismatchHook.body));assert.equal(mismatchHook.body.error,'stripe_payment_amount_mismatch');
    const fundedEvent={id:'evt_pi',type:'payment_intent.succeeded',data:{object:{id:'pi_edge_1',amount_received:101000,currency:'aud',metadata:{relaymarket_payment_id:paymentId}}}};
    const fundedHook=await stripeWebhook(e,fundedEvent);assert.equal(fundedHook.r.status,200,JSON.stringify(fundedHook.body));
    const duplicateHook=await stripeWebhook(e,fundedEvent);assert.equal(duplicateHook.r.status,200);assert.equal(duplicateHook.body.duplicate,true);
    const fundedReplay=await stripeWebhook(e,fundedEvent);assert.equal(fundedReplay.r.status,200);assert.equal(fundedReplay.body.duplicate,true);
    assert.equal((await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_stripe_provider'})})).r.status,200);
    assert.equal((await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_stripe_provider',artifact:{done:true}})})).r.status,200);
    assert.equal((await api(e,`/api/v1/tasks/${taskId}/complete`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_stripe_requester'})})).r.status,200);
    const release=await api(e,`/api/v1/payments/${paymentId}/release`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'stripe-release-edge-0001'},body:JSON.stringify({requesterAgentId:'agt_stripe_requester'})});
    assert.equal(release.r.status,200,JSON.stringify(release.body));assert.equal(release.body.payment.status,'released');assert.equal(release.body.payment.providerReference,'pi_edge_1');assert.equal(release.body.payment.transferReference,'tr_edge_1');assert.equal(release.body.transfer.id,'tr_edge_1');
    const financials=(await api(e,'/api/v1/payments/stats')).body;assert.equal(financials.byCurrency.AUD.platformRevenueMinor,1000);assert.equal(financials.byCurrency.AUD.providerPayoutMinor,100000);
    const beforeRefund=(await api(e,'/api/v1/stats')).body;assert.equal(beforeRefund.counters['payment.funded'],1);assert.equal(beforeRefund.counters['payment.released'],1);
    const refund=await api(e,`/api/v1/payments/${paymentId}/refund`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'stripe-refund-edge-0001'},body:JSON.stringify({requesterAgentId:'agt_stripe_requester'})});
    assert.equal(refund.r.status,200,JSON.stringify(refund.body));assert.equal(refund.body.payment.status,'refunded');assert.equal(refund.body.payment.providerReference,'pi_edge_1');assert.equal(refund.body.payment.transferReference,'tr_edge_1');assert.equal(refund.body.payment.refundReference,'re_edge_1');assert.equal(refund.body.reversal.id,'trr_edge_1');
    const afterRefund=(await api(e,'/api/v1/payments/stats')).body;assert.equal(afterRefund.byCurrency.AUD.platformRevenueMinor,0);assert.equal(afterRefund.byCurrency.AUD.providerPayoutMinor,0);assert.equal(afterRefund.byCurrency.AUD.refundedMinor,101000);
  } finally { globalThis.fetch=originalFetch; }
});

test('MCP Stripe payment creation uses the same provider session path as REST',async()=>{
  const e=await env({PAYMENT_PROVIDER:'stripe',PAYMENT_PROCESSOR_COST_POLICY:'platform_absorbs',STRIPE_SECRET_KEY:'sk_test_mcp',STRIPE_WEBHOOK_SECRET:'whsec_mcp'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const u=String(url),body=new URLSearchParams(init.body||'');
    if(u.endsWith('/v1/accounts')) return Response.json({id:'acct_mcp_provider',country:'AU',charges_enabled:false,payouts_enabled:false,details_submitted:false});
    if(u.endsWith('/v1/account_links')) return Response.json({url:'https://connect.stripe.test/mcp-onboard'});
    if(u.endsWith('/v1/payment_intents')){assert.equal(body.get('amount'),'5050');assert.equal(body.get('metadata[relaymarket_platform_fee_bps]'),'100');return Response.json({id:'pi_mcp_1',client_secret:'pi_mcp_secret',status:'requires_payment_method'});}
    throw new Error(`Unexpected Stripe URL ${u}`);
  };
  try{
    const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_mcp_pay_requester',name:'MCP Pay Requester'})});
    const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_mcp_pay_provider',name:'MCP Pay Provider',capabilities:['coding']})});
    await api(e,'/api/v1/agents/agt_mcp_pay_provider/payout/stripe/onboard',{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({country:'AU'})});
    e.DB.db.prepare("UPDATE agent_payout_accounts SET payouts_enabled=1,details_submitted=1 WHERE agent_id='agt_mcp_pay_provider'").run();
    const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'MCP paid task',requesterAgentId:'agt_mcp_pay_requester',requiredCapabilities:['coding']})});
    const taskId=task.body.task.id;
    await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_mcp_pay_provider'})});
    const mcp=await api(e,'/mcp',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'mcp-stripe-payment-001'},body:JSON.stringify({jsonrpc:'2.0',id:77,method:'tools/call',params:{name:'relaymarket_create_payment',arguments:{taskId,requesterAgentId:'agt_mcp_pay_requester',amountMinor:5000,currency:'AUD'}}})});
    assert.equal(mcp.r.status,200,JSON.stringify(mcp.body));
    assert.equal(mcp.body.result.structuredContent.payment.providerReference,'pi_mcp_1');
    assert.equal(mcp.body.result.structuredContent.payment.platformFeeMinor,50);
    assert.equal(mcp.body.result.structuredContent.providerSession.clientSecret,'pi_mcp_secret');
  }finally{globalThis.fetch=originalFetch;}
});

test('trust layer links operators and blocks artificial self-dealing across agents',async()=>{
  const e=await env();
  const buyer=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_trust_buyer',name:'Buyer'})});
  const seller=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_trust_seller',name:'Seller',capabilities:['research']})});
  const buyerKey=buyer.body.credential.apiKey,sellerKey=seller.body.credential.apiKey;
  const op=await api(e,'/api/v1/agents/agt_trust_buyer/trust/operator',{method:'POST',headers:{authorization:`Bearer ${buyerKey}`},body:JSON.stringify({kind:'business',country:'AU',legalName:'Example Pty Ltd',businessIdentifierType:'ABN',businessIdentifier:'12345678901'})});
  assert.equal(op.r.status,201);assert.equal(op.body.trust.trustStatus,'basic');assert.equal(op.body.trust.operator.businessIdentifierLast4,'8901');
  const operatorId=op.body.trust.operator.id;
  // Simulate a verified administrative link of a second agent to the same operator.
  e.DB.db.prepare('INSERT INTO operator_agents(operator_id,agent_id,linked_at) VALUES(?,?,?)').run(operatorId,'agt_trust_seller',new Date().toISOString());
  e.DB.db.prepare("UPDATE agents SET operator_id=?,trust_status='basic' WHERE id=?").run(operatorId,'agt_trust_seller');
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${buyerKey}`},body:JSON.stringify({title:'Related-party task',requesterAgentId:'agt_trust_buyer',requiredCapabilities:['research']})});
  const accept=await api(e,`/api/v1/tasks/${task.body.task.id}/accept`,{method:'POST',headers:{authorization:`Bearer ${sellerKey}`},body:JSON.stringify({providerAgentId:'agt_trust_seller'})});
  assert.equal(accept.r.status,409);assert.equal(accept.body.error,'related_operator_assignment_not_allowed');
});

test('reviews cannot be manufactured without a completed marketplace task',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_review_guard',name:'Review Guard'})});
  assert.equal(a.r.status,201);
  assert.throws(()=>e.DB.db.prepare("INSERT INTO reviews(id,agent_id,task_id,rating,comment,created_at) VALUES('rev_fake','agt_review_guard','missing',5,'fake',?)").run(new Date().toISOString()));
});

test('trust reports require an authenticated reporter and preserve evidence privately',async()=>{
  const e=await env();
  const reporter=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_reporter',name:'Reporter'})});
  const unauth=await api(e,'/api/v1/trust/reports',{method:'POST',body:JSON.stringify({caseType:'review_manipulation',reason:'Suspicious reciprocal reviews'})});
  assert.equal(unauth.r.status,401);assert.equal(unauth.body.error,'reporter_agent_required');
  const r=await api(e,'/api/v1/trust/reports',{method:'POST',headers:{authorization:`Bearer ${reporter.body.credential.apiKey}`,'idempotency-key':'trust-report-001'},body:JSON.stringify({reporterAgentId:'agt_reporter',caseType:'review_manipulation',reason:'Suspicious reciprocal reviews',evidence:{reference:'public-signal-1'}})});
  assert.equal(r.r.status,201);assert.equal(r.body.case.status,'open');
  const row=e.DB.db.prepare('SELECT case_type,status,reason,evidence_json FROM trust_cases WHERE id=?').get(r.body.case.id);assert.equal(row.case_type,'review_manipulation');assert.equal(row.status,'open');assert.match(row.evidence_json,/agt_reporter/);
});

test('Australian operator verification separates registry evidence from full verified-operator status',async()=>{
  const e=await env({TRUST_ADMIN_TOKEN:'trust-secret'});
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_trust_au',name:'AU Trust',endpoints:[{protocol:'mcp',url:'https://example.com/mcp'}]})});
  const key=a.body.credential.apiKey;
  const op=await api(e,'/api/v1/agents/agt_trust_au/trust/operator',{method:'POST',headers:{authorization:`Bearer ${key}`,'idempotency-key':'op-create-au'},body:JSON.stringify({kind:'business',country:'AU',legalName:'Example Pty Ltd'})});
  assert.equal(op.r.status,201);assert.equal(op.body.trust.trustStatus,'basic');const operatorId=op.body.trust.operator.id;
  const repo=new (await import('../cloudflare/src/repository.js')).D1Repository(e.DB);
  const trust=await repo.applyAustralianBusinessVerification('agt_trust_au',{provider:'abr_abn_lookup',identifierType:'ABN',identifier:'51824753556',registryName:'EXAMPLE PTY LTD',status:'Active',active:true,state:'QLD',postcode:'4000'},{source:'edge-test'});
  assert.ok(trust.badges.includes('au_business_registry'));assert.ok(!trust.badges.includes('verified_operator'));
  const stored=e.DB.db.prepare('SELECT business_identifier_hash,business_identifier_last4 FROM operators WHERE id=?').get(operatorId);
  assert.match(stored.business_identifier_hash,/^[a-f0-9]{64}$/);assert.equal(stored.business_identifier_last4,'3556');
  const evidence=e.DB.db.prepare("SELECT evidence_json FROM verification_checks WHERE operator_id=? AND check_type='business' ORDER BY checked_at DESC LIMIT 1").get(operatorId);
  assert.doesNotMatch(evidence.evidence_json,/51824753556/);
  const summary=await api(e,'/api/v1/trust/summary');assert.equal(summary.r.status,200);assert.equal(summary.body.trust.currentBusinessRegistryChecks,1);assert.equal(summary.body.trust.verifiedOperators,0);
  const adminBad=await api(e,`/api/v1/internal/operators/${operatorId}/sanctions-review`,{method:'POST',headers:{authorization:'Bearer wrong','idempotency-key':'sanctions-bad'},body:JSON.stringify({status:'clear'})});assert.equal(adminBad.r.status,401);
  const admin=await api(e,`/api/v1/internal/operators/${operatorId}/sanctions-review`,{method:'POST',headers:{authorization:'Bearer trust-secret','idempotency-key':'sanctions-ok'},body:JSON.stringify({status:'clear'})});assert.equal(admin.r.status,200);assert.equal(admin.body.operator.sanctionsStatus,'clear');
});

test('full Verified Operator requires all au-v1 gates, not any single badge',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_full_verify',name:'Full Verify',endpoints:[{protocol:'mcp',url:'https://example.com/mcp'}]})});
  const key=a.body.credential.apiKey;
  const created=await api(e,'/api/v1/agents/agt_full_verify/trust/operator',{method:'POST',headers:{authorization:`Bearer ${key}`},body:JSON.stringify({kind:'business',country:'AU'})});
  const operatorId=created.body.trust.operator.id;
  const {D1Repository}=await import('../cloudflare/src/repository.js');const repo=new D1Repository(e.DB);
  let trust=await repo.applyAustralianBusinessVerification('agt_full_verify',{provider:'abr_abn_lookup',identifierType:'ABN',identifier:'51824753556',registryName:'EXAMPLE PTY LTD',status:'Active',active:true},{source:'edge-test'});
  assert.equal(trust.trustStatus,'basic');
  const challenge=await repo.createVerificationChallenge('agt_full_verify',0,{source:'edge-test'});await repo.completeVerificationChallenge('agt_full_verify',challenge.id,{source:'edge-test'});
  trust=await repo.getAgentTrust('agt_full_verify');assert.ok(trust.badges.includes('endpoint_control'));assert.equal(trust.trustStatus,'basic');
  const payout=await repo.savePayoutAccount('agt_full_verify',{id:'acct_full_verify',country:'AU',charges_enabled:true,payouts_enabled:true,details_submitted:true});await repo.syncPaymentProviderVerification('agt_full_verify',payout,{source:'edge-test'});
  trust=await repo.getAgentTrust('agt_full_verify');assert.ok(trust.badges.includes('identity_provider'));assert.ok(trust.badges.includes('payment_ready'));assert.equal(trust.trustStatus,'basic');
  await repo.setOperatorSanctionsStatus(operatorId,'clear',{source:'edge-test',actorId:'test-admin'});
  trust=await repo.getAgentTrust('agt_full_verify');assert.equal(trust.trustStatus,'verified');assert.ok(trust.badges.includes('verified_operator'));assert.equal(trust.operator.operatorVerified,true);
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.verifiedOperators,1);assert.equal(stats.verifiedAgents,1);
});

test('operator verification fails closed when current business or payment evidence is withdrawn',async()=>{
  const e=await env();const {D1Repository}=await import('../cloudflare/src/repository.js');const repo=new D1Repository(e.DB);
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_revoke_verify',name:'Revoke Verify',endpoints:[{protocol:'mcp',url:'https://example.com/mcp'}]})});const key=a.body.credential.apiKey;
  const op=await api(e,'/api/v1/agents/agt_revoke_verify/trust/operator',{method:'POST',headers:{authorization:`Bearer ${key}`},body:JSON.stringify({kind:'business',country:'AU'})});const operatorId=op.body.trust.operator.id;
  await repo.applyAustralianBusinessVerification('agt_revoke_verify',{provider:'abr_abn_lookup',identifierType:'ABN',identifier:'51824753556',registryName:'EXAMPLE PTY LTD',status:'Active',active:true});const c=await repo.createVerificationChallenge('agt_revoke_verify',0);await repo.completeVerificationChallenge('agt_revoke_verify',c.id);
  let payout=await repo.savePayoutAccount('agt_revoke_verify',{id:'acct_revoke_verify',country:'AU',charges_enabled:true,payouts_enabled:true,details_submitted:true});await repo.syncPaymentProviderVerification('agt_revoke_verify',payout);await repo.setOperatorSanctionsStatus(operatorId,'clear');assert.equal((await repo.getAgentTrust('agt_revoke_verify')).trustStatus,'verified');
  payout=await repo.savePayoutAccount('agt_revoke_verify',{id:'acct_revoke_verify',country:'AU',charges_enabled:false,payouts_enabled:false,details_submitted:true});await repo.syncPaymentProviderVerification('agt_revoke_verify',payout);let trust=await repo.getAgentTrust('agt_revoke_verify');assert.equal(trust.trustStatus,'basic');assert.ok(!trust.badges.includes('payment_ready'));assert.equal(trust.operator.identityVerificationCurrent,false);
  await repo.syncPaymentProviderVerification('agt_revoke_verify',await repo.savePayoutAccount('agt_revoke_verify',{id:'acct_revoke_verify',country:'AU',charges_enabled:true,payouts_enabled:true,details_submitted:true}));await repo.applyAustralianBusinessVerification('agt_revoke_verify',{provider:'abr_abn_lookup',identifierType:'ABN',identifier:'51824753556',registryName:'EXAMPLE PTY LTD',status:'Cancelled',active:false});trust=await repo.getAgentTrust('agt_revoke_verify');assert.equal(trust.trustStatus,'basic');assert.ok(!trust.badges.includes('au_business_registry'));assert.equal(trust.operator.businessVerificationCurrent,false);
});

test('Payment Protection holds funded payments on dispute and requires reviewed resolution',async()=>{
  const e=await env({PAYMENT_PROVIDER:'mock',TRUST_ADMIN_TOKEN:'trust-secret'});
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_protect_requester',name:'Protect Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_protect_provider',name:'Protect Provider',capabilities:['coding']})});
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Protected task',description:'evidence flow',requesterAgentId:'agt_protect_requester',requiredCapabilities:['coding']})});const taskId=task.body.task.id;
  await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_provider'})});
  const created=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_protect_requester',amountMinor:25000,currency:'AUD'})});const paymentId=created.body.payment.id;
  await api(e,`/api/v1/payments/${paymentId}/mock/fund`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({actorAgentId:'agt_protect_requester'})});
  await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_provider'})});
  await api(e,`/api/v1/tasks/${taskId}/messages`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({fromAgentId:'agt_protect_provider',body:'Delivery evidence message'})});
  await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_provider',artifact:{result:'v1'}})});
  const dispute=await api(e,`/api/v1/tasks/${taskId}/dispute`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_protect_requester',reason:'Output does not meet scope'})});assert.equal(dispute.r.status,200);
  const payment=(await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'GET',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`}})).body.payment;assert.equal(payment.status,'held');
  const protection=await api(e,`/api/v1/tasks/${taskId}/protection`,{method:'GET',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`}});assert.equal(protection.r.status,200,JSON.stringify(protection.body));assert.equal(protection.body.protection.status,'open');assert.equal(protection.body.protection.snapshot.artifactDigest,dispute.body.task.artifactDigest);assert.equal(protection.body.protection.snapshot.messageCount,1);
  const evidence=await api(e,`/api/v1/tasks/${taskId}/protection`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`,'idempotency-key':'protect-evidence-1'},body:JSON.stringify({evidenceType:'note',content:'Artifact matches requested schema'})});assert.equal(evidence.r.status,201);assert.equal(evidence.body.protection.status,'evidence');assert.equal(evidence.body.protection.evidence.length,1);
  const ordinaryRefund=await api(e,`/api/v1/payments/${paymentId}/refund`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_protect_requester'})});assert.equal(ordinaryRefund.r.status,503); // mock provider has no Stripe endpoint; repository guard is covered below
  const {D1Repository}=await import('../cloudflare/src/repository.js');const repo=new D1Repository(e.DB);assert.equal(await repo.hasOpenProtectionCaseForPayment(paymentId),true);
  const caseId=protection.body.protection.id;
  const unauthorized=await api(e,`/api/v1/internal/protection-cases/${caseId}/resolve`,{method:'POST',headers:{authorization:'Bearer wrong','idempotency-key':'resolve-wrong'},body:JSON.stringify({decision:'refund'})});assert.equal(unauthorized.r.status,401);
  const resolved=await api(e,`/api/v1/internal/protection-cases/${caseId}/resolve`,{method:'POST',headers:{authorization:'Bearer trust-secret','idempotency-key':'resolve-refund'},body:JSON.stringify({decision:'refund',note:'Reviewed evidence; refund approved'})});assert.equal(resolved.r.status,200,JSON.stringify(resolved.body));assert.equal(resolved.body.protection.status,'resolved_refund');
  assert.equal((await repo.getPayment(paymentId)).status,'refunded');assert.equal((await repo.getTask(taskId)).status,'cancelled');assert.equal(await repo.hasOpenProtectionCaseForPayment(paymentId),false);
  const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['protection.case_opened'],1);assert.equal(stats.counters['protection.resolved_refund'],1);assert.equal(stats.counters['payment.held'],1);
});

test('Payment Protection evidence is available consistently over MCP and A2A',async()=>{
  const e=await env({PAYMENT_PROVIDER:'mock'});
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_protect_protocol_requester',name:'Protection Protocol Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_protect_protocol_provider',name:'Protection Protocol Provider',capabilities:['audit']})});
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Protocol protection task',description:'MCP/A2A protection parity',requesterAgentId:'agt_protect_protocol_requester',requiredCapabilities:['audit']})});
  const taskId=task.body.task.id;
  await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_protocol_provider'})});
  const created=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_protect_protocol_requester',amountMinor:10000,currency:'AUD'})});
  await api(e,`/api/v1/payments/${created.body.payment.id}/mock/fund`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({actorAgentId:'agt_protect_protocol_requester'})});
  await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_protocol_provider'})});
  await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_protect_protocol_provider',artifact:{result:'audit-output'}})});
  await api(e,`/api/v1/tasks/${taskId}/dispute`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({requesterAgentId:'agt_protect_protocol_requester',reason:'Need review'})});

  const mcp=await api(e,'/mcp',{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({jsonrpc:'2.0',id:91,method:'tools/call',params:{name:'relaymarket_get_protection_case',arguments:{taskId,actorAgentId:'agt_protect_protocol_provider'}}})});
  assert.equal(mcp.r.status,200,JSON.stringify(mcp.body));
  assert.equal(mcp.body.result.structuredContent.protection.taskId,taskId);

  const a2a=await api(e,'/a2a',{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`,'idempotency-key':'protect-a2a-evidence-001'},body:JSON.stringify({jsonrpc:'2.0',id:92,method:'message/send',params:{message:{messageId:'protect-a2a-92',role:'user',parts:[{kind:'data',data:{action:'add_protection_evidence',taskId,actorAgentId:'agt_protect_protocol_provider',evidenceType:'note',content:'Provider evidence submitted through A2A'}}]}}})});
  assert.equal(a2a.r.status,200,JSON.stringify(a2a.body));
  const data=a2a.body.result.artifacts[0].parts[0].data;
  assert.equal(data.protection.status,'evidence');
  assert.equal(data.protection.evidence.at(-1).content.value,'Provider evidence submitted through A2A');
});

test('operator risk review blocks paid economic actions until audited restore',async()=>{
  const e=await env({PAYMENT_PROVIDER:'mock',TRUST_ADMIN_TOKEN:'trust-secret'});
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_risk_requester',name:'Risk Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_risk_provider',name:'Risk Provider',capabilities:['coding']})});
  const op=await api(e,'/api/v1/agents/agt_risk_provider/trust/operator',{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({kind:'business',country:'AU'})});
  const operatorId=op.body.trust.operator.id;
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Risk hold paid task',requesterAgentId:'agt_risk_requester',requiredCapabilities:['coding']})});
  const taskId=task.body.task.id;
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_risk_provider'})})).r.status,200);
  const hold=await api(e,`/api/v1/internal/operators/${operatorId}/risk-review`,{method:'POST',headers:{authorization:'Bearer trust-secret','idempotency-key':'risk-hold-0001'},body:JSON.stringify({level:'review',score:70,reason:'manual review required'})});
  assert.equal(hold.r.status,200,JSON.stringify(hold.body));assert.equal(hold.body.operator.riskLevel,'review');
  const blocked=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'risk-payment-blocked-0001'},body:JSON.stringify({requesterAgentId:'agt_risk_requester',amountMinor:5000,currency:'AUD'})});
  assert.equal(blocked.r.status,409,JSON.stringify(blocked.body));assert.equal(blocked.body.error,'operator_risk_review');
  const restore=await api(e,`/api/v1/internal/operators/${operatorId}/risk-review`,{method:'POST',headers:{authorization:'Bearer trust-secret','idempotency-key':'risk-restore-0001'},body:JSON.stringify({level:'normal',score:0,reason:'manual review cleared'})});
  assert.equal(restore.r.status,200,JSON.stringify(restore.body));assert.equal(restore.body.operator.riskLevel,'normal');
  const allowed=await api(e,`/api/v1/tasks/${taskId}/payment`,{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`,'idempotency-key':'risk-payment-allowed-0001'},body:JSON.stringify({requesterAgentId:'agt_risk_requester',amountMinor:5000,currency:'AUD'})});
  assert.equal(allowed.r.status,201,JSON.stringify(allowed.body));
  const actions=e.DB.db.prepare('SELECT action_type FROM moderation_actions WHERE operator_id=? ORDER BY created_at').all(operatorId).map(x=>x.action_type);
  assert.deepEqual(actions,['payment_hold','restore']);
});


test('task messages are private to authenticated participants across REST and MCP',async()=>{
  const e=await env();
  const requester=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_msg_requester',name:'Message Requester'})});
  const provider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_msg_provider',name:'Message Provider'})});
  const outsider=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_msg_outsider',name:'Message Outsider'})});
  const task=await api(e,'/api/v1/tasks',{method:'POST',headers:{authorization:`Bearer ${requester.body.credential.apiKey}`},body:JSON.stringify({title:'Private messages',requesterAgentId:'agt_msg_requester'})});
  const taskId=task.body.task.id;
  await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({providerAgentId:'agt_msg_provider'})});
  await api(e,`/api/v1/tasks/${taskId}/messages`,{method:'POST',headers:{authorization:`Bearer ${provider.body.credential.apiKey}`},body:JSON.stringify({fromAgentId:'agt_msg_provider',toAgentId:'agt_msg_requester',body:'private payload'})});
  const noAuth=await api(e,`/api/v1/tasks/${taskId}/messages`);assert.equal(noAuth.r.status,401);
  const denied=await api(e,`/api/v1/tasks/${taskId}/messages`,{headers:{authorization:`Bearer ${outsider.body.credential.apiKey}`}});assert.equal(denied.r.status,403);
  const allowed=await api(e,`/api/v1/tasks/${taskId}/messages`,{headers:{authorization:`Bearer ${requester.body.credential.apiKey}`}});assert.equal(allowed.r.status,200);assert.equal(allowed.body.messages[0].body,'private payload');
  const mcpDenied=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'relaymarket_task_messages',arguments:{taskId}}})});assert.equal(mcpDenied.r.status,400);
});

test('public event feed is redacted and does not expose internal event details',async()=>{
  const e=await env();
  await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_event_redaction',name:'Event Redaction'})});
  const events=await api(e,'/api/v1/events');assert.equal(events.r.status,200);assert.ok(events.body.events.length>0);
  for(const event of events.body.events){assert.deepEqual(Object.keys(event).sort(),['at','source','type']);assert.equal('detail' in event,false);}
});

test('unverified registrations stay out of public discovery until endpoint control is proven',async()=>{
  const e=await env();
  const a=await api(e,'/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_public_gate',name:'Public Gate',endpoints:[{protocol:'mcp',url:'https://agent.example/mcp'}]})});
  let agents=(await api(e,'/api/v1/agents')).body.agents;assert.equal(agents.some(x=>x.id==='agt_public_gate'),false);
  const challenge=await api(e,'/api/v1/agents/agt_public_gate/verification-challenges',{method:'POST',headers:{authorization:`Bearer ${a.body.credential.apiKey}`},body:JSON.stringify({endpointIndex:0})});
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(challenge.body.challenge.token,{status:200});
  try{const verified=await api(e,`/api/v1/agents/agt_public_gate/verification-challenges/${challenge.body.challenge.id}/verify`,{method:'POST',headers:{authorization:`Bearer ${a.body.credential.apiKey}`},body:'{}'});assert.equal(verified.r.status,200);}finally{globalThis.fetch=originalFetch;}
  agents=(await api(e,'/api/v1/agents')).body.agents;assert.equal(agents.some(x=>x.id==='agt_public_gate'),true);
});

test('production portal sends anti-clickjacking, CSP and HSTS headers without wildcard CORS',async()=>{
  const e=await env();const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');e.ASSETS={fetch:async()=>new Response(html,{status:200,headers:{'content-type':'text/html'}})};
  const r=await worker.fetch(new Request('https://relaymarket.test/'),e);
  assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);assert.match(r.headers.get('strict-transport-security')||'',/max-age=31536000/);assert.equal(r.headers.get('access-control-allow-origin'),null);
  const evil=await worker.fetch(new Request('https://relaymarket.test/api/v1/agents',{method:'OPTIONS',headers:{origin:'https://evil.example'}}),e);assert.equal(evil.status,403);
  const same=await worker.fetch(new Request('https://relaymarket.test/api/v1/agents',{method:'OPTIONS',headers:{origin:'https://relaymarket.test'}}),e);assert.equal(same.status,204);assert.equal(same.headers.get('access-control-allow-origin'),'https://relaymarket.test');
});
