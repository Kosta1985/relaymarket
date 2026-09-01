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
async function env(){const DB=new SQLiteD1();for(const migration of migrations)DB.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`,import.meta.url),'utf8'));return{DB,ASSETS:{fetch:async()=>new Response('asset',{status:200})}};}
async function api(e,path,{method='GET',apiKey,body,source='kpi-test'}={}){const headers={'content-type':'application/json','x-relaymarket-source':source};if(apiKey)headers.authorization=`Bearer ${apiKey}`;const response=await worker.fetch(new Request(`https://taskbay.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),e);const text=await response.text();return{status:response.status,body:text?JSON.parse(text):null};}
async function register(e,id,name,capabilities=[]){const r=await api(e,'/api/v1/agents',{method:'POST',body:{id,name,capabilities,protocols:['mcp']}});assert.equal(r.status,201);return{agent:r.body.agent,key:r.body.credential.apiKey};}
function verify(e,id){const stamp=new Date().toISOString();e.DB.db.prepare('UPDATE agents SET verified=1,verified_at=?,updated_at=? WHERE id=?').run(stamp,stamp,id);}

test('launch KPI endpoint reports observed marketplace conversions without inventing users',async()=>{
  const e=await env();
  const requester=await register(e,'agt_kpi_requester','KPI Requester',['planning']);
  const provider=await register(e,'agt_kpi_provider','KPI Provider',['api review']);
  verify(e,provider.agent.id);

  const created=await api(e,'/api/v1/tasks',{method:'POST',apiKey:requester.key,source:'framework-openai-agents',body:{title:'KPI task',description:'Generate one real lifecycle sample for KPI contract testing.',acceptanceCriteria:['Return an artifact'],requesterAgentId:requester.agent.id,requiredCapabilities:['api-review'],preferredProtocols:['mcp']}});
  assert.equal(created.status,201);const taskId=created.body.task.id;
  const matches=await api(e,`/api/v1/tasks/${taskId}/matches`,{source:'framework-openai-agents'});assert.equal(matches.status,200);
  const selected=await api(e,`/api/v1/tasks/${taskId}/select`,{method:'POST',apiKey:requester.key,source:'framework-openai-agents',body:{requesterAgentId:requester.agent.id,providerAgentId:provider.agent.id}});assert.equal(selected.status,200);
  const accepted=await api(e,`/api/v1/tasks/${taskId}/accept`,{method:'POST',apiKey:provider.key,source:'framework-openai-agents',body:{providerAgentId:provider.agent.id}});assert.equal(accepted.status,200);
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/start`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id}})).status,200);
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id,artifact:{ok:true}}})).status,200);
  assert.equal((await api(e,`/api/v1/tasks/${taskId}/complete`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id}})).status,200);

  const kpis=await api(e,'/api/v1/kpis');
  assert.equal(kpis.status,200);
  assert.equal(kpis.body.contractVersion,'launch-v1');
  assert.equal(kpis.body.endpointVerifiedAgents,1);
  assert.equal(kpis.body.independentVerifiedOperators,0);
  assert.equal(kpis.body.providerSelections,1);
  assert.equal(kpis.body.acceptedTasks,1);
  assert.equal(kpis.body.deliveredTasks,1);
  assert.equal(kpis.body.completedTasks,1);
  assert.equal(kpis.body.conversion.selectionToAccept,1);
  assert.equal(kpis.body.conversion.acceptToDeliver,1);
  assert.equal(kpis.body.conversion.deliverToComplete,1);
  assert.equal(kpis.body.conversion.deliveredToDispute,0);
  assert.ok(kpis.body.medianMinutes.createToSelection>=0);
  assert.ok(kpis.body.medianMinutes.createToCompletion>=0);
  const source=kpis.body.acquisitionSources.find(row=>row.source==='framework-openai-agents');
  assert.ok(source);
  assert.equal(source.taskCreations,1);
  assert.equal(source.matchRequests,1);
  assert.equal(source.providerSelections,1);
  assert.match(kpis.body.definitions.matchRequests,/not unique users/i);
});
