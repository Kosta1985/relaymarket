import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../cloudflare/src/index.js';

class SQLiteD1 {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql){this.db.exec(sql);}
  prepare(sql){return new SQLiteStmt(this.db,sql);}
  async batch(stmts){const out=[];this.db.exec('BEGIN IMMEDIATE');try{for(const stmt of stmts)out.push(await stmt._exec());this.db.exec('COMMIT');return out;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
class SQLiteStmt {
  constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
  bind(...args){return new SQLiteStmt(this.db,this.sql,args);}
  async all(){return{results:this.db.prepare(this.sql).all(...this.args),success:true,meta:{changes:0}};}
  async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
  async run(){const result=this.db.prepare(this.sql).run(...this.args);return{success:true,meta:{changes:Number(result.changes||0),last_row_id:result.lastInsertRowid}};}
  async _exec(){return /^\s*(select|pragma|with)\b/i.test(this.sql)?this.all():this.run();}
}

const migrations=['0001_relaymarket.sql','0002_payments.sql','0003_trust_safety.sql','0004_operator_verification.sql','0005_payment_protection.sql','0006_risk_holds.sql','0007_requester_provider_loop.sql'];
async function createEnv(){const DB=new SQLiteD1();for(const migration of migrations)DB.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`,import.meta.url),'utf8'));return{DB,ASSETS:{fetch:async()=>new Response('asset',{status:200})}};}
async function api(env,path,{apiKey,method='GET',body,headers={}}={}){const requestHeaders={'content-type':'application/json','x-relaymarket-source':'launch-loop-test',...headers};if(apiKey)requestHeaders.authorization=`Bearer ${apiKey}`;const response=await worker.fetch(new Request(`https://taskbay.test${path}`,{method,headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body)}),env);const text=await response.text();return{status:response.status,body:text?JSON.parse(text):null};}
async function register(env,id,name,capabilities=[]){const result=await api(env,'/api/v1/agents',{method:'POST',body:{id,name,capabilities,protocols:['mcp']}});assert.equal(result.status,201);return{agent:result.body.agent,key:result.body.credential.apiKey};}

async function runRequesterProviderLoop(){
  const env=await createEnv();
  const requester=await register(env,'agt_launch_requester','Launch Requester',['planning']);
  const selected=await register(env,'agt_launch_selected','Selected Provider',['api review']);
  const other=await register(env,'agt_launch_other','Other Provider',['api review']);

  const created=await api(env,'/api/v1/tasks',{method:'POST',apiKey:requester.key,body:{title:'Review launch API',description:'Review the release candidate and return evidence.',acceptanceCriteria:['No P0 findings','Return a concise report','Include artifact references'],requesterAgentId:requester.agent.id,requiredCapabilities:['api-review'],preferredProtocols:['mcp']}});
  assert.equal(created.status,201);
  const taskId=created.body.task.id;
  assert.deepEqual(created.body.task.acceptanceCriteria,['No P0 findings','Return a concise report','Include artifact references']);

  const matches=await api(env,`/api/v1/tasks/${taskId}/matches`);
  assert.equal(matches.status,200);
  assert.ok(matches.body.matches.some(row=>row.agent.id===selected.agent.id));

  const selection=await api(env,`/api/v1/tasks/${taskId}/select`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,providerAgentId:selected.agent.id}});
  assert.equal(selection.status,200);
  assert.equal(selection.body.task.selectedProviderAgentId,selected.agent.id);
  assert.ok(selection.body.task.selectedAt);

  const wrongAccept=await api(env,`/api/v1/tasks/${taskId}/accept`,{method:'POST',apiKey:other.key,body:{providerAgentId:other.agent.id}});
  assert.equal(wrongAccept.status,403);
  assert.equal(wrongAccept.body.error,'provider_not_selected');

  const accepted=await api(env,`/api/v1/tasks/${taskId}/accept`,{method:'POST',apiKey:selected.key,body:{providerAgentId:selected.agent.id}});
  assert.equal(accepted.status,200);
  assert.equal(accepted.body.task.providerAgentId,selected.agent.id);

  const started=await api(env,`/api/v1/tasks/${taskId}/start`,{method:'POST',apiKey:selected.key,body:{providerAgentId:selected.agent.id}});
  assert.equal(started.status,200);
  assert.equal(started.body.task.status,'working');

  const delivered=await api(env,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',apiKey:selected.key,body:{providerAgentId:selected.agent.id,artifact:{report:'v1'},note:'Initial review'}});
  assert.equal(delivered.status,200);
  assert.equal(delivered.body.task.status,'delivered');
  assert.match(delivered.body.task.artifactDigest,/^[a-f0-9]{64}$/);

  const revised=await api(env,`/api/v1/tasks/${taskId}/revise`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,reason:'Add evidence for the final recommendation.'}});
  assert.equal(revised.status,200);
  assert.equal(revised.body.task.status,'working');
  assert.equal(revised.body.task.revisionCount,1);
  assert.equal(revised.body.task.lastRevisionNote,'Add evidence for the final recommendation.');

  const redelivered=await api(env,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',apiKey:selected.key,body:{providerAgentId:selected.agent.id,artifact:{report:'v2',evidence:['ref-1']},note:'Revision delivered'}});
  assert.equal(redelivered.status,200);
  assert.equal(redelivered.body.task.status,'delivered');

  const completed=await api(env,`/api/v1/tasks/${taskId}/complete`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,rating:5,comment:'Accepted after revision'}});
  assert.equal(completed.status,200);
  assert.equal(completed.body.task.status,'completed');

  const stats=await api(env,'/api/v1/stats');
  assert.equal(stats.status,200);
  assert.equal(stats.body.counters['task.provider_selected'],1);
  assert.equal(stats.body.counters['task.revision_requested'],1);
  assert.equal(stats.body.counters['task.completed'],1);

  const events=await api(env,'/api/v1/events?limit=50');
  assert.equal(events.status,200);
  const eventTypes=events.body.events.map(event=>event.type);
  assert.ok(eventTypes.includes('task.provider_selected'));
  assert.ok(eventTypes.includes('task.revision_requested'));
}

test('requester selects a provider and completes a revision-backed delivery loop',runRequesterProviderLoop);
