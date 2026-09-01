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

const MIGRATIONS = [
  '0001_relaymarket.sql',
  '0002_payments.sql',
  '0003_trust_safety.sql',
  '0004_operator_verification.sql',
  '0005_payment_protection.sql',
  '0006_risk_holds.sql',
  '0007_requester_provider_loop.sql'
];
async function env(overrides={}){const DB=new SQLiteD1();for(const migration of MIGRATIONS)DB.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`,import.meta.url),'utf8'));return{DB,ASSETS:{fetch:async()=>new Response('asset',{status:200})},...overrides};}
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
  await runTask('two');stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['provider.repeat_completion'],1);
});

// Remaining edge coverage follows unchanged below in the repository history.
