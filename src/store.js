import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { id, now, normalizeAgent, normalizeTask, normalizeMessage, scoreMatch, transitionAllowed, sha256 } from './domain.js';
import { PLATFORM_FEE_BPS, normalizePayment, paymentTransitionAllowed } from './payments.js';

const DATA_FILE=process.env.RELAYMARKET_DATA_FILE||new URL('../data/market.json',import.meta.url);
let state={agents:[],tasks:[],events:[],reviews:[],messages:[],payments:[],counters:newCounters(),idempotency:[],credentials:[],verificationChallenges:[]};
let loaded=false;let writeChain=Promise.resolve();

export async function initStore(){
  if(loaded)return;
  try{
    state=JSON.parse(await readFile(DATA_FILE,'utf8'));
    for(const k of ['agents','tasks','events','reviews','messages','payments','idempotency','credentials','verificationChallenges'])if(!Array.isArray(state[k]))state[k]=[];
    if(!state.counters||typeof state.counters!=='object')state.counters=newCounters();
    if(!state.counters.totals)state.counters.totals={};
    if(!state.counters.bySource)state.counters.bySource={};
    if(!state.counters.daily)state.counters.daily={};
  }catch{seed();await persist();}
  loaded=true;
}

export function listAgents(filters={}){let rows=state.agents.map(withReputation);if(filters.includeUnverified!==true)rows=rows.filter(a=>a.verified);if(filters.capability)rows=rows.filter(a=>a.capabilities.includes(filters.capability));if(filters.protocol)rows=rows.filter(a=>a.protocols.includes(filters.protocol));if(filters.available==='true')rows=rows.filter(a=>a.availability);return rows;}
export function getAgent(agentId){const a=state.agents.find(x=>x.id===agentId);return a?withReputation(a):null;}
export async function createAgent(input,ctx={}){if(input.id&&state.agents.some(x=>x.id===input.id))throw problem('agent_id_exists',409);const a=normalizeAgent(input);state.agents.push(a);audit('agent.registered',{agentId:a.id,source:ctx.source});count('agent.registered',ctx.source);await persist();return withReputation(a);}
export async function updateAgent(agentId,input,ctx={}){const i=state.agents.findIndex(x=>x.id===agentId);if(i<0)throw problem('agent_not_found',404);const old=state.agents[i];const next=normalizeAgent({...old,...input,id:old.id,createdAt:old.createdAt});next.verified=old.verified;state.agents[i]=next;audit('agent.updated',{agentId,source:ctx.source});count('agent.updated',ctx.source);await persist();return withReputation(next);}
export function listTasks(status='all'){const rows=[...state.tasks].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return status==='all'?rows:rows.filter(t=>t.status===status);}
export function getTask(taskId){return state.tasks.find(x=>x.id===taskId)||null;}
export async function createTask(input,ctx={}){if(input.requesterAgentId&&!getRawAgent(input.requesterAgentId))throw problem('requester_agent_not_found',404);const t=normalizeTask(input);state.tasks.push(t);audit('task.created',{taskId:t.id,requesterAgentId:t.requesterAgentId,source:ctx.source});count('task.created',ctx.source);await persist();return t;}
export function matches(taskId){const task=mustTask(taskId);return listAgents({available:'true'}).filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,score:scoreMatch(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}
export async function selectProvider(taskId,requesterAgentId,providerAgentId,ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);if(t.status!=='open')throw problem('task_must_be_open_for_provider_selection',409);if(!getRawAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===requesterAgentId)throw problem('self_assignment_not_allowed',409);t.selectedProviderAgentId=providerAgentId;t.selectedAt=now();t.updatedAt=now();audit('task.provider_selected',{taskId,requesterAgentId,providerAgentId,source:ctx.source});count('task.provider_selected',ctx.source);await persist();return t;}
export async function acceptTask(taskId,providerAgentId,ctx={}){const t=mustTask(taskId);if(!getRawAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);if(t.selectedProviderAgentId&&t.selectedProviderAgentId!==providerAgentId)throw problem('provider_not_selected',403);move(t,'accepted');t.selectedProviderAgentId??=providerAgentId;t.selectedAt??=now();t.providerAgentId=providerAgentId;t.acceptedAt=now();audit('task.accepted',{taskId,providerAgentId,source:ctx.source});count('task.accepted',ctx.source);await persist();return t;}
export async function startTask(taskId,providerAgentId,ctx={}){const t=mustProvider(taskId,providerAgentId),payment=getTaskPayment(taskId);if(payment&&!['funded','held'].includes(payment.status))throw problem('payment_not_funded',409);move(t,'working');t.startedAt=now();audit('task.started',{taskId,providerAgentId,source:ctx.source});count('task.started',ctx.source);await persist();return t;}
export async function deliverTask(taskId,providerAgentId,input={},ctx={}){const t=mustProvider(taskId,providerAgentId);move(t,'delivered');t.artifact=input.artifact??null;t.artifactDigest=await sha256(input.artifact??'');t.deliveryNote=String(input.note||'').slice(0,2000)||null;t.deliveredAt=now();audit('task.delivered',{taskId,providerAgentId,artifactDigest:t.artifactDigest,source:ctx.source});count('task.delivered',ctx.source);await persist();return t;}
export async function reviseTask(taskId,requesterAgentId,input={},ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);if(t.status!=='delivered')throw problem('task_must_be_delivered_for_revision',409);move(t,'working');t.revisionCount=Number(t.revisionCount||0)+1;t.revisionRequestedAt=now();t.lastRevisionNote=String(input.reason||input.note||'Revision requested').slice(0,2000);audit('task.revision_requested',{taskId,requesterAgentId,providerAgentId:t.providerAgentId,revisionCount:t.revisionCount,source:ctx.source});count('task.revision_requested',ctx.source);await persist();return t;}
export async function completeTask(taskId,requesterAgentId,input={},ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);move(t,'completed');t.completedAt=now();if(t.providerAgentId&&input.rating)addReview(t.providerAgentId,t.id,input.rating,input.comment);audit('task.completed',{taskId,requesterAgentId,providerAgentId:t.providerAgentId,source:ctx.source});count('task.completed',ctx.source);if(t.providerAgentId&&completedForProvider(t.providerAgentId)>1)count('provider.repeat_completion',ctx.source);await persist();return t;}
export async function disputeTask(taskId,requesterAgentId,input={},ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);move(t,'disputed');t.disputeReason=String(input.reason||'').slice(0,1000)||'unspecified';audit('task.disputed',{taskId,requesterAgentId,source:ctx.source});count('task.disputed',ctx.source);await persist();return t;}
export async function cancelTask(taskId,actorAgentId,ctx={}){const t=mustTask(taskId);if(t.requesterAgentId&&actorAgentId!==t.requesterAgentId&&actorAgentId!==t.providerAgentId)throw problem('actor_not_authorized',403);move(t,'cancelled');audit('task.cancelled',{taskId,actorAgentId,source:ctx.source});count('task.cancelled',ctx.source);await persist();return t;}
export function listMessages(taskId){mustTask(taskId);return state.messages.filter(x=>x.taskId===taskId);}
export async function createMessage(taskId,input,ctx={}){const t=mustTask(taskId);if(!input.fromAgentId)throw problem('from_agent_required',400);const participants=[t.requesterAgentId,t.providerAgentId].filter(Boolean);if(!participants.includes(input.fromAgentId))throw problem('sender_not_task_participant',403);if(input.toAgentId&&!participants.includes(input.toAgentId))throw problem('recipient_not_task_participant',403);const m=normalizeMessage(taskId,input);if(!m.body)throw problem('message_body_required',400);state.messages.push(m);audit('task.message',{taskId,messageId:m.id,fromAgentId:m.fromAgentId,source:ctx.source});count('task.message',ctx.source);await persist();return m;}


export async function issueCredential(agentId,ctx={}){
  if(!getRawAgent(agentId))throw problem('agent_not_found',404);
  const keyId=crypto.randomBytes(8).toString('hex'),secret=crypto.randomBytes(24).toString('base64url'),apiKey=`rmk_${keyId}_${secret}`;
  state.credentials.push({id:`cred_${keyId}`,agentId,keyHash:hashSecret(apiKey),createdAt:now(),revokedAt:null,lastUsedAt:null});
  audit('agent.credential_issued',{agentId,credentialId:`cred_${keyId}`,source:ctx.source});count('agent.credential_issued',ctx.source);await persist();
  return {apiKey,credentialId:`cred_${keyId}`,agentId};
}
export async function authenticateApiKey(apiKey){
  if(!apiKey||!String(apiKey).startsWith('rmk_'))return null;const hash=hashSecret(String(apiKey));const c=state.credentials.find(x=>x.keyHash===hash&&!x.revokedAt);if(!c)return null;c.lastUsedAt=now();return c.agentId;
}
export function listCredentials(agentId){
  if(!getRawAgent(agentId))throw problem('agent_not_found',404);
  return state.credentials.filter(x=>x.agentId===agentId).map(({keyHash,...c})=>({...c,active:!c.revokedAt}));
}
export async function revokeCredential(agentId,credentialId,ctx={}){
  const c=state.credentials.find(x=>x.id===credentialId&&x.agentId===agentId);if(!c)throw problem('credential_not_found',404);if(c.revokedAt)return {credentialId:c.id,agentId,revokedAt:c.revokedAt};
  const active=state.credentials.filter(x=>x.agentId===agentId&&!x.revokedAt);if(active.length<=1)throw problem('cannot_revoke_last_active_credential',409);
  c.revokedAt=now();audit('agent.credential_revoked',{agentId,credentialId,source:ctx.source});count('agent.credential_revoked',ctx.source);await persist();return {credentialId:c.id,agentId,revokedAt:c.revokedAt};
}
export async function rotateCredential(agentId,credentialId,ctx={}){
  const old=state.credentials.find(x=>x.id===credentialId&&x.agentId===agentId&&!x.revokedAt);if(!old)throw problem('credential_not_found',404);
  const next=await issueCredential(agentId,ctx);old.revokedAt=now();audit('agent.credential_rotated',{agentId,oldCredentialId:credentialId,newCredentialId:next.credentialId,source:ctx.source});count('agent.credential_rotated',ctx.source);await persist();return next;
}

export async function createVerificationChallenge(agentId,endpointIndex=0,source='direct'){
  const agent=getRawAgent(agentId);if(!agent)throw problem('agent_not_found',404);const endpoint=agent.endpoints?.[Number(endpointIndex)];if(!endpoint)throw problem('endpoint_not_found',404);
  state.verificationChallenges=state.verificationChallenges.filter(x=>x.agentId!==agentId||x.completedAt);
  const token=`rm_verify_${crypto.randomBytes(24).toString('base64url')}`,origin=new URL(endpoint.url).origin,challenge={id:id('vfy'),agentId,endpointIndex:Number(endpointIndex),endpointUrl:endpoint.url,verificationUrl:`${origin}/.well-known/relaymarket-verification.txt`,token,createdAt:now(),expiresAt:new Date(Date.now()+15*60_000).toISOString(),completedAt:null};
  state.verificationChallenges.push(challenge);audit('agent.verification_challenge_created',{agentId,challengeId:challenge.id,source});count('agent.verification_challenge_created',source);await persist();return structuredClone(challenge);
}
export function getVerificationChallenge(agentId,challengeId){return state.verificationChallenges.find(x=>x.agentId===agentId&&x.id===challengeId)||null;}
export async function completeVerificationChallenge(agentId,challengeId,source='direct'){
  const challenge=getVerificationChallenge(agentId,challengeId);if(!challenge)throw problem('verification_challenge_not_found',404);if(challenge.completedAt)return getAgent(agentId);if(Date.parse(challenge.expiresAt)<Date.now())throw problem('verification_challenge_expired',410);const i=state.agents.findIndex(x=>x.id===agentId);state.agents[i].verified=true;state.agents[i].verifiedAt=now();challenge.completedAt=now();audit('agent.endpoint_verified',{agentId,challengeId,source});count('agent.endpoint_verified',source);await persist();return getAgent(agentId);
}



export function listPayments(filters={}){
  let rows=[...state.payments].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(filters.taskId)rows=rows.filter(x=>x.taskId===filters.taskId);
  if(filters.status)rows=rows.filter(x=>x.status===filters.status);
  if(filters.requesterAgentId)rows=rows.filter(x=>x.requesterAgentId===filters.requesterAgentId);
  return rows.map(x=>structuredClone(x));
}
export function getPayment(paymentId){const p=state.payments.find(x=>x.id===paymentId);return p?structuredClone(p):null;}
export function getTaskPayment(taskId){const p=[...state.payments].reverse().find(x=>x.taskId===taskId&&!['failed','cancelled'].includes(x.status));return p?structuredClone(p):null;}
export async function createPayment(taskId,requesterAgentId,input={},ctx={}){
  const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);if(t.status!=='accepted')throw problem('task_must_be_accepted_before_payment',409);
  if(state.payments.some(x=>x.taskId===taskId&&!['failed','cancelled','refunded'].includes(x.status)))throw problem('active_payment_exists',409);
  const money=normalizePayment(input),stamp=now(),payment={id:id('pay'),taskId,requesterAgentId:t.requesterAgentId||requesterAgentId,providerAgentId:t.providerAgentId,provider:'mock',providerReference:null,status:'created',...money,createdAt:stamp,updatedAt:stamp,fundedAt:null,heldAt:null,releasedAt:null,refundedAt:null,failedAt:null,cancelledAt:null};
  state.payments.push(payment);audit('payment.created',{paymentId:payment.id,taskId,requesterAgentId,providerAgentId:t.providerAgentId,amountMinor:payment.amountMinor,currency:payment.currency,platformFeeMinor:payment.platformFeeMinor,source:ctx.source});count('payment.created',ctx.source);await persist();return structuredClone(payment);
}
export async function transitionPayment(paymentId,to,actorAgentId,input={},ctx={}){
  const p=state.payments.find(x=>x.id===paymentId);if(!p)throw problem('payment_not_found',404);if(!paymentTransitionAllowed(p.status,to))throw problem(`invalid_payment_transition_${p.status}_to_${to}`,409);
  if(['funded','cancelled','refunded'].includes(to)&&p.requesterAgentId&&actorAgentId!==p.requesterAgentId)throw problem('payment_requester_mismatch',403);
  if(to==='released'&&actorAgentId!==p.requesterAgentId)throw problem('payment_requester_mismatch',403);
  const task=mustTask(p.taskId);if(to==='released'&&task.status!=='completed')throw problem('task_must_be_completed_before_release',409);
  const stamp=now();p.status=to;p.updatedAt=stamp;if(!p.providerReference&&input.providerReference)p.providerReference=String(input.providerReference).slice(0,200)||null;if(input.transferReference)p.transferReference=String(input.transferReference).slice(0,200)||null;if(input.refundReference)p.refundReference=String(input.refundReference).slice(0,200)||null;
  if(to==='funded')p.fundedAt=stamp;if(to==='held')p.heldAt=stamp;if(to==='released')p.releasedAt=stamp;if(to==='refunded')p.refundedAt=stamp;if(to==='failed')p.failedAt=stamp;if(to==='cancelled')p.cancelledAt=stamp;
  audit(`payment.${to}`,{paymentId:p.id,taskId:p.taskId,amountMinor:p.amountMinor,currency:p.currency,platformFeeMinor:p.platformFeeMinor,source:ctx.source});count(`payment.${to}`,ctx.source);await persist();return structuredClone(p);
}
export function paymentStats(){
  const byCurrency={};for(const p of state.payments){const c=byCurrency[p.currency]??={created:0,funded:0,released:0,refunded:0,gmvMinor:0,netGmvMinor:0,platformRevenueMinor:0,providerPayoutMinor:0,refundedMinor:0};c.created++;if(['funded','held','released','refunded'].includes(p.status)){c.funded++;c.gmvMinor+=p.amountMinor;c.netGmvMinor+=p.amountMinor;}if(p.status==='released'){c.released++;c.platformRevenueMinor+=p.platformFeeMinor;c.providerPayoutMinor+=p.amountMinor;}if(p.status==='refunded'){c.refunded++;c.netGmvMinor-=p.amountMinor;c.refundedMinor+=p.amountMinor+p.platformFeeMinor;}}
  return{platformFeeBps:PLATFORM_FEE_BPS,platformFeePercent:PLATFORM_FEE_BPS/100,payments:state.payments.length,byCurrency};
}

export async function recordMetric(metric,ctx={}){count(metric,ctx.source);if(ctx.audit!==false)audit(metric,{source:normalizeSource(ctx.source),...ctx.detail});await persist();}
export function metrics(){return structuredClone(state.counters);}
export function stats(){const all=state.tasks;return{agents:state.agents.length,availableAgents:state.agents.filter(a=>a.availability).length,tasks:all.length,openTasks:all.filter(t=>t.status==='open').length,activeTasks:all.filter(t=>['accepted','working','delivered','disputed'].includes(t.status)).length,completedTasks:all.filter(t=>t.status==='completed').length,repeatProviders:repeatProviderCount(all),messages:state.messages.length,payments:state.payments.length,paymentStats:paymentStats(),counters:structuredClone(state.counters.totals)};}
export function recentEvents(limit=30){return state.events.slice(-Math.max(1,Math.min(100,limit))).reverse();}

export async function getIdempotent(scope,key,requestHash){if(!key)return null;pruneIdempotency();const hit=state.idempotency.find(x=>x.scope===scope&&x.key===key);if(!hit)return null;if(hit.requestHash!==requestHash)throw problem('idempotency_key_reused_with_different_request',409);return structuredClone(hit.response);}
export async function saveIdempotent(scope,key,requestHash,response){if(!key)return;pruneIdempotency();state.idempotency.push({scope,key,requestHash,response:structuredClone(response),createdAt:now()});if(state.idempotency.length>2000)state.idempotency.splice(0,state.idempotency.length-2000);await persist();}

function getRawAgent(agentId){return state.agents.find(x=>x.id===agentId)}
function withReputation(a){const r=state.reviews.filter(x=>x.agentId===a.id),completed=completedForProvider(a.id),disputed=state.tasks.filter(t=>t.providerAgentId===a.id&&t.status==='disputed').length;return{...a,reputation:{rating:r.length?Number((r.reduce((s,x)=>s+x.rating,0)/r.length).toFixed(2)):null,reviews:r.length,completedTasks:completed,disputedTasks:disputed}};}
function completedForProvider(agentId){return state.tasks.filter(t=>t.providerAgentId===agentId&&t.status==='completed').length}
function addReview(agentId,taskId,rating,comment){if(state.reviews.some(x=>x.taskId===taskId))return;const n=Math.max(1,Math.min(5,Number(rating)));state.reviews.push({id:id('rev'),agentId,taskId,rating:n,comment:String(comment||'').slice(0,1000),createdAt:now()});}
function mustTask(taskId){const t=getTask(taskId);if(!t)throw problem('task_not_found',404);return t}
function mustProvider(taskId,providerAgentId){const t=mustTask(taskId);if(t.providerAgentId!==providerAgentId)throw problem('provider_mismatch',403);return t}
function authorizeRequester(t,id){if(t.requesterAgentId&&id!==t.requesterAgentId)throw problem('requester_mismatch',403)}
function move(t,to){if(!transitionAllowed(t.status,to))throw problem(`invalid_transition_${t.status}_to_${to}`,409);t.status=to;t.updatedAt=now()}
function audit(type,detail){state.events.push({id:id('evt'),type,detail,at:now()});if(state.events.length>5000)state.events.splice(0,state.events.length-5000)}
function count(metric,source='direct'){const src=normalizeSource(source),day=now().slice(0,10);state.counters.totals[metric]=(state.counters.totals[metric]||0)+1;state.counters.bySource[src]??={};state.counters.bySource[src][metric]=(state.counters.bySource[src][metric]||0)+1;state.counters.daily[day]??={};state.counters.daily[day][metric]=(state.counters.daily[day][metric]||0)+1;}
function hashSecret(value){return crypto.createHash('sha256').update(value).digest('hex')}
function normalizeSource(source){const s=String(source||'direct').toLowerCase().replace(/[^a-z0-9_.:-]/g,'').slice(0,80);return s||'direct'}
function newCounters(){return{totals:{},bySource:{},daily:{}}}
function pruneIdempotency(){const cutoff=Date.now()-24*60*60*1000;state.idempotency=state.idempotency.filter(x=>Date.parse(x.createdAt)>=cutoff)}
function problem(code,status){return Object.assign(new Error(code.replaceAll('_',' ')),{code,status})}
function repeatProviderCount(all){const c=new Map();for(const t of all.filter(t=>t.status==='completed'&&t.providerAgentId))c.set(t.providerAgentId,(c.get(t.providerAgentId)||0)+1);return [...c.values()].filter(n=>n>1).length}
async function persist(){writeChain=writeChain.then(async()=>{const path=DATA_FILE instanceof URL?DATA_FILE:new URL(`file://${DATA_FILE}`);await mkdir(dirname(path.pathname),{recursive:true});const tmp=new URL(`${path.href}.tmp`);await writeFile(tmp,JSON.stringify(state,null,2));await rename(tmp,path)});return writeChain}
function seed(){state={agents:[normalizeAgent({id:'agt_research',name:'Atlas Research',description:'Synthetic demo research agent.',capabilities:['research','summarization'],protocols:['mcp','a2a'],pricing:{mode:'free'}}),normalizeAgent({id:'agt_code',name:'Forge Code',description:'Synthetic demo coding agent.',capabilities:['coding','testing','code-review'],protocols:['mcp','openapi'],pricing:{mode:'quote'}}),normalizeAgent({id:'agt_docs',name:'Clarity Writer',description:'Synthetic demo writing agent.',capabilities:['writing','summarization','translation'],protocols:['a2a','http'],pricing:{mode:'free'}})],tasks:[normalizeTask({id:'tsk_demo',title:'Summarise public agent interoperability patterns',description:'Create a concise synthetic report comparing MCP and A2A handoff patterns.',requesterAgentId:'agt_code',requiredCapabilities:['research','summarization'],preferredProtocols:['mcp']})],events:[],reviews:[],messages:[],payments:[],counters:newCounters(),idempotency:[],credentials:[],verificationChallenges:[]};audit('system.seeded',{synthetic:true})}
