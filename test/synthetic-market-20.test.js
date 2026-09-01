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
async function api(env,path,{apiKey,method='GET',body,source='synthetic-demo-20'}={}){const headers={'content-type':'application/json','x-relaymarket-source':source};if(apiKey)headers.authorization=`Bearer ${apiKey}`;const response=await worker.fetch(new Request(`https://taskbay.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);const text=await response.text();return{status:response.status,body:text?JSON.parse(text):null};}
async function register(env,index){const id=`agt_synth_${String(index).padStart(2,'0')}`;const result=await api(env,'/api/v1/agents',{method:'POST',body:{id,name:`Synthetic Demo Agent ${index}`,description:'Synthetic CI-only TaskBay lifecycle test identity. Not a real external user.',capabilities:['synthetic-demo',`skill-${index%5}`],protocols:['mcp']}});assert.equal(result.status,201);return{agent:result.body.agent,key:result.body.credential.apiKey};}
function verify(env,id){const stamp=new Date().toISOString();const result=env.DB.db.prepare('UPDATE agents SET verified=1,verified_at=?,updated_at=? WHERE id=?').run(stamp,stamp,id);assert.equal(Number(result.changes),1);}

test('20 synthetic agents complete 20 isolated marketplace lifecycles',async()=>{
  const env=await createEnv();
  const agents=[];
  for(let i=0;i<20;i++){
    const entry=await register(env,i);
    verify(env,entry.agent.id);
    agents.push(entry);
  }

  for(let i=0;i<20;i++){
    const requester=agents[i];
    const provider=agents[(i+1)%agents.length];
    const created=await api(env,'/api/v1/tasks',{method:'POST',apiKey:requester.key,body:{title:`Synthetic demo task ${i}`,description:'CI-only synthetic marketplace task used to exercise TaskBay matching and lifecycle transitions.',acceptanceCriteria:['Return a synthetic artifact','Complete through authenticated lifecycle'],requesterAgentId:requester.agent.id,requiredCapabilities:['synthetic-demo'],preferredProtocols:['mcp']}});
    assert.equal(created.status,201);
    const taskId=created.body.task.id;

    const matches=await api(env,`/api/v1/tasks/${taskId}/matches`);
    assert.equal(matches.status,200);
    assert.ok(matches.body.matches.some(row=>row.agent.id===provider.agent.id));

    const selected=await api(env,`/api/v1/tasks/${taskId}/select`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,providerAgentId:provider.agent.id}});
    assert.equal(selected.status,200);

    const accepted=await api(env,`/api/v1/tasks/${taskId}/accept`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id}});
    assert.equal(accepted.status,200);

    const started=await api(env,`/api/v1/tasks/${taskId}/start`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id}});
    assert.equal(started.status,200);

    const delivered=await api(env,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id,artifact:{synthetic:true,task:i,version:1},note:'Synthetic CI-only delivery'}});
    assert.equal(delivered.status,200);

    if(i%4===0){
      const revised=await api(env,`/api/v1/tasks/${taskId}/revise`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,reason:'Synthetic revision path exercise'}});
      assert.equal(revised.status,200);
      const redelivered=await api(env,`/api/v1/tasks/${taskId}/deliver`,{method:'POST',apiKey:provider.key,body:{providerAgentId:provider.agent.id,artifact:{synthetic:true,task:i,version:2},note:'Synthetic revised delivery'}});
      assert.equal(redelivered.status,200);
    }

    const completed=await api(env,`/api/v1/tasks/${taskId}/complete`,{method:'POST',apiKey:requester.key,body:{requesterAgentId:requester.agent.id,rating:5,comment:'Synthetic CI-only completion'}});
    assert.equal(completed.status,200);
    assert.equal(completed.body.task.status,'completed');
  }

  const stats=await api(env,'/api/v1/stats');
  assert.equal(stats.status,200);
  assert.equal(stats.body.counters['task.provider_selected'],20);
  assert.equal(stats.body.counters['task.accepted'],20);
  assert.equal(stats.body.counters['task.started'],20);
  assert.equal(stats.body.counters['task.revision_requested'],5);
  assert.equal(stats.body.counters['task.completed'],20);

  const kpis=await api(env,'/api/v1/kpis');
  assert.equal(kpis.status,200);
  assert.equal(kpis.body.endpointVerifiedAgents,20);
  assert.equal(kpis.body.providerSelections,20);
  assert.equal(kpis.body.acceptedTasks,20);
  assert.equal(kpis.body.completedTasks,20);
  assert.equal(kpis.body.conversion.selectionToAccept,1);
  assert.equal(kpis.body.conversion.deliverToComplete,1);
  const source=kpis.body.acquisitionSources.find(row=>row.source==='synthetic-demo-20');
  assert.ok(source);
  assert.equal(source.taskCreations,20);
  assert.equal(source.matchRequests,20);
  assert.equal(source.providerSelections,20);
});
