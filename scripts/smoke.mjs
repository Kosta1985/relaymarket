import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const port=8899,base=`http://127.0.0.1:${port}`,data='/tmp/relaymarket-smoke.json';
await rm(data,{force:true});
let child;
async function boot(){child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),RELAYMARKET_DATA_FILE:data},stdio:'ignore'});for(let i=0;i<40;i++){try{if((await fetch(`${base}/health`)).ok)return}catch{}await sleep(100)}throw new Error('server did not boot')}
async function stop(){if(child){child.kill('SIGTERM');await sleep(200);child=null}}
async function json(path,options={}){const r=await fetch(`${base}${path}`,{...options,headers:{'content-type':'application/json','x-relaymarket-source':'smoke',...(options.headers||{})}});const x=await r.json();assert.ok(r.ok,`${path}: ${JSON.stringify(x)}`);return x}

try{
  await boot();
  assert.equal((await json('/health')).version,'0.12.0');
  const card=await json('/.well-known/agent-card.json');assert.equal(card.name,'RelayMarket');
  const mcp=await json('/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})});assert.equal(mcp.result.serverInfo.name,'relaymarket');

  const requesterReg=await json('/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_smoke_requester',name:'Smoke Requester',capabilities:['orchestration'],protocols:['mcp']})});const requester=requesterReg.agent,requesterKey=requesterReg.credential.apiKey;
  const providerReg=await json('/api/v1/agents',{method:'POST',body:JSON.stringify({id:'agt_smoke_provider',name:'Smoke Provider',capabilities:['research','summarization','smoke-specialist'],protocols:['mcp']})});const provider=providerReg.agent,providerKey=providerReg.credential.apiKey;
  const taskBody={title:'Smoke task',description:'Synthetic end-to-end task',requesterAgentId:requester.id,requiredCapabilities:['research','summarization','smoke-specialist'],preferredProtocols:['mcp']};
  const taskResponse=await json('/api/v1/tasks',{method:'POST',headers:{'idempotency-key':'smoke-task-create-0001','authorization':`Bearer ${requesterKey}`},body:JSON.stringify(taskBody)});
  const task=taskResponse.task;
  const replay=await json('/api/v1/tasks',{method:'POST',headers:{'idempotency-key':'smoke-task-create-0001','authorization':`Bearer ${requesterKey}`},body:JSON.stringify(taskBody)});assert.equal(replay.task.id,task.id);
  const ranked=(await json(`/api/v1/tasks/${task.id}/matches`)).matches;assert.equal(ranked[0].agent.id,provider.id);
  const unauthorized=await fetch(`${base}/api/v1/tasks/${task.id}/accept`,{method:'POST',headers:{'content-type':'application/json','x-relaymarket-source':'smoke'},body:JSON.stringify({providerAgentId:provider.id})});assert.equal(unauthorized.status,401);
  const wrongIdentity=await fetch(`${base}/api/v1/tasks/${task.id}/accept`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${requesterKey}`},body:JSON.stringify({providerAgentId:provider.id})});assert.equal(wrongIdentity.status,403);
  assert.equal((await json(`/api/v1/tasks/${task.id}/accept`,{method:'POST',headers:{authorization:`Bearer ${providerKey}`},body:JSON.stringify({providerAgentId:provider.id})})).task.status,'accepted');
  await json(`/api/v1/tasks/${task.id}/messages`,{method:'POST',headers:{authorization:`Bearer ${requesterKey}`},body:JSON.stringify({fromAgentId:requester.id,toAgentId:provider.id,type:'question',body:'Please return a synthetic summary.'})});
  assert.equal((await json(`/api/v1/tasks/${task.id}/start`,{method:'POST',headers:{authorization:`Bearer ${providerKey}`},body:JSON.stringify({providerAgentId:provider.id})})).task.status,'working');
  const delivered=(await json(`/api/v1/tasks/${task.id}/deliver`,{method:'POST',headers:{authorization:`Bearer ${providerKey}`},body:JSON.stringify({providerAgentId:provider.id,artifact:{summary:'synthetic result'},note:'done'})})).task;assert.equal(delivered.status,'delivered');assert.equal(delivered.artifactDigest.length,64);
  assert.equal((await json(`/api/v1/tasks/${task.id}/complete`,{method:'POST',headers:{authorization:`Bearer ${requesterKey}`},body:JSON.stringify({requesterAgentId:requester.id,rating:5,comment:'Synthetic smoke success'})})).task.status,'completed');
  const rep=(await json(`/api/v1/agents/${provider.id}`)).agent.reputation;assert.equal(rep.rating,5);assert.equal(rep.completedTasks,1);
  assert.equal((await json(`/api/v1/tasks/${task.id}/messages`,{headers:{authorization:`Bearer ${requesterKey}`}})).messages.length,1);
  const metricSnapshot=await json('/api/v1/metrics');assert.equal(metricSnapshot.totals['task.created'],1);assert.ok(metricSnapshot.bySource.smoke['task.created']>=1);

  await stop();await boot();
  const persisted=(await json(`/api/v1/tasks/${task.id}`)).task;assert.equal(persisted.status,'completed');
  const persistedProvider=(await json(`/api/v1/agents/${provider.id}`)).agent;assert.equal(persistedProvider.reputation.rating,5);
  console.log('RelayMarket end-to-end smoke passed');
}finally{await stop();await rm(data,{force:true})}
