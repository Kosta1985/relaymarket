import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../cloudflare/src/index.js';
import { agentCard, mcpTools } from '../src/discovery.js';

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

async function makeEnv(){
  const DB=new SQLiteD1();
  for(const migration of ['0001_relaymarket.sql','0002_payments.sql','0003_trust_safety.sql','0004_operator_verification.sql','0005_payment_protection.sql','0006_risk_holds.sql']){
    DB.exec(await readFile(new URL(`../cloudflare/migrations/${migration}`,import.meta.url),'utf8'));
  }
  return{DB,ASSETS:{fetch:async()=>new Response('asset',{status:200})}};
}
async function api(env,path,init={}){
  const r=await worker.fetch(new Request(`https://relaymarket.test${path}`,{...init,headers:{'content-type':'application/json',...(init.headers||{})}}),env);
  const text=await r.text();
  return{r,body:text?JSON.parse(text):null};
}
function mcpBody(id,name,args){return JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});}
function a2aBody(id,agent){return JSON.stringify({jsonrpc:'2.0',id,method:'message/send',params:{message:{messageId:`msg-${id}`,role:'user',parts:[{kind:'data',data:{action:'register_agent',agent}}]}}});}

test('MCP advertises registration and registers a real agent idempotently without logging the raw key',async()=>{
  const e=await makeEnv();
  const tools=await api(e,'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
  assert.equal(tools.r.status,200);
  assert.ok(tools.body.result.tools.some(tool=>tool.name==='relaymarket_register_agent'));

  const agent={id:'agt_mcp_machine_registration',name:'MCP Machine Registration',description:'Integration test agent',capabilities:['research'],protocols:['mcp'],endpoints:[{protocol:'mcp',url:'https://agent.example/mcp'}]};
  const init={method:'POST',headers:{'idempotency-key':'mcp-machine-register-001','x-relaymarket-source':'framework-openai-agents'},body:mcpBody(2,'relaymarket_register_agent',agent)};
  const first=await api(e,'/mcp',init);
  assert.equal(first.r.status,200);
  const value=first.body.result.structuredContent;
  assert.equal(value.agent.id,agent.id);
  assert.equal(value.trust.registrationIsVerification,false);
  assert.match(value.credential.apiKey,/^rmk_/);

  const stored=e.DB.db.prepare('SELECT a.event_source,c.key_hash FROM agents a JOIN agent_credentials c ON c.agent_id=a.id WHERE a.id=?').get(agent.id);
  assert.equal(stored.event_source,'framework-openai-agents');
  assert.match(stored.key_hash,/^[a-f0-9]{64}$/);
  assert.notEqual(stored.key_hash,value.credential.apiKey);

  const replay=await api(e,'/mcp',{...init,body:mcpBody(3,'relaymarket_register_agent',agent)});
  assert.equal(replay.r.status,200);
  assert.equal(replay.body.result.structuredContent.credential.apiKey,value.credential.apiKey);
  const count=e.DB.db.prepare('SELECT COUNT(*) AS c FROM agents').get().c;
  assert.equal(Number(count),1);

  const publicProfile=await api(e,`/api/v1/agents/${agent.id}`);
  assert.equal(publicProfile.r.status,200);
  assert.doesNotMatch(JSON.stringify(publicProfile.body),/rmk_/);
});

test('MCP machine registration requires an Idempotency-Key header',async()=>{
  const e=await makeEnv();
  const agent={name:'No Idempotency Agent',capabilities:['research'],protocols:['mcp']};
  const out=await api(e,'/mcp',{method:'POST',body:mcpBody(4,'relaymarket_register_agent',agent)});
  assert.equal(out.r.status,400);
  assert.match(out.body.error.message,/idempotency/i);
  const count=e.DB.db.prepare('SELECT COUNT(*) AS c FROM agents').get().c;
  assert.equal(Number(count),0);
});

test('A2A register_agent creates one idempotent registration and preserves source attribution',async()=>{
  const e=await makeEnv();
  const agent={id:'agt_a2a_machine_registration',name:'A2A Machine Registration',capabilities:['planning'],protocols:['a2a'],endpoints:[{protocol:'a2a',url:'https://a2a-agent.example/a2a'}]};
  const init={method:'POST',headers:{'idempotency-key':'a2a-machine-register-001','x-relaymarket-source':'framework-google-adk'},body:a2aBody(10,agent)};
  const first=await api(e,'/a2a',init);
  assert.equal(first.r.status,200);
  const value=first.body.result.artifacts[0].parts[0].data;
  assert.equal(value.agent.id,agent.id);
  assert.match(value.credential.apiKey,/^rmk_/);
  assert.equal(value.trust.registrationIsVerification,false);

  const replay=await api(e,'/a2a',{...init,body:a2aBody(11,agent)});
  assert.equal(replay.r.status,200);
  assert.equal(replay.body.result.artifacts[0].parts[0].data.credential.apiKey,value.credential.apiKey);
  const row=e.DB.db.prepare('SELECT event_source FROM agents WHERE id=?').get(agent.id);
  assert.equal(row.event_source,'framework-google-adk');
  const count=e.DB.db.prepare('SELECT COUNT(*) AS c FROM agents').get().c;
  assert.equal(Number(count),1);
});

test('registration discovery metadata separates registration from verification',()=>{
  const tool=mcpTools().find(item=>item.name==='relaymarket_register_agent');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required,['name','capabilities','protocols']);
  assert.match(tool.description,/not verification/i);
  const skill=agentCard('https://relaymarket.example').skills.find(item=>item.id==='register_agent');
  assert.ok(skill);
  assert.match(skill.description,/not verification/i);
});
