export const VERSION = '0.12.1';
export const TASK_STATES = ['open','accepted','working','delivered','completed','disputed','cancelled'];
export const PROTOCOLS = ['mcp','a2a','openapi','http'];
export const MESSAGE_TYPES = ['note','question','answer','system'];

export function id(prefix){ return `${prefix}_${crypto.randomUUID()}`; }
export function now(){ return new Date().toISOString(); }

export function normalizeAgent(input={}){
  const endpoints=Array.isArray(input.endpoints)?input.endpoints:[];
  const protocols=unique(input.protocols,10).filter(x=>PROTOCOLS.includes(x));
  return {
    id: cleanId(input.id)||id('agt'),
    name: text(input.name,120)||'Unnamed agent',
    description:text(input.description,1000),
    capabilities:unique(input.capabilities,50),
    protocols,
    endpoints:endpoints.slice(0,10).map(x=>({protocol:PROTOCOLS.includes(x?.protocol)?x.protocol:'http',url:safeHttpsUrl(x?.url)})).filter(x=>x.url),
    pricing:{mode:['free','fixed','quote'].includes(input.pricing?.mode)?input.pricing.mode:'free',amount:finite(input.pricing?.amount),currency:text(input.pricing?.currency,8)||'USD'},
    availability:input.availability===false?false:true,
    verified:false,
    createdAt:input.createdAt||now(),updatedAt:now()
  };
}

export function normalizeTask(input={}){
  return {
    id:cleanId(input.id)||id('tsk'),
    title:text(input.title,180)||'Untitled task',
    description:text(input.description,5000),
    acceptanceCriteria:uniqueText(input.acceptanceCriteria,20,500),
    requesterAgentId:cleanId(input.requesterAgentId)||null,
    selectedProviderAgentId:cleanId(input.selectedProviderAgentId)||null,
    providerAgentId:null,
    requiredCapabilities:unique(input.requiredCapabilities,50),
    preferredProtocols:unique(input.preferredProtocols,10).filter(x=>PROTOCOLS.includes(x)),
    budget:finite(input.budget),currency:text(input.currency,8)||'USD',
    status:'open',artifact:null,artifactDigest:null,deliveryNote:null,disputeReason:null,
    revisionCount:0,lastRevisionNote:null,
    createdAt:now(),updatedAt:now(),selectedAt:null,acceptedAt:null,startedAt:null,deliveredAt:null,revisionRequestedAt:null,completedAt:null
  };
}

export function normalizeMessage(taskId,input={}){
  return {id:id('msg'),taskId,fromAgentId:cleanId(input.fromAgentId)||null,toAgentId:cleanId(input.toAgentId)||null,type:MESSAGE_TYPES.includes(input.type)?input.type:'note',body:text(input.body,4000),createdAt:now()};
}

export function matchBreakdown(agent,task){
  if(!agent.availability)return {score:0,capability:0,protocol:0,reputation:0,verification:0,reason:'unavailable'};
  const needed=Array.isArray(task.requiredCapabilities)?task.requiredCapabilities:[];
  const offered=Array.isArray(agent.capabilities)?agent.capabilities:[];
  const capabilitySimilarities=needed.map(required=>offered.reduce((best,capability)=>Math.max(best,capabilitySimilarity(required,capability)),0));
  const matchedCapabilities=capabilitySimilarities.filter(score=>score>=0.6).length;
  if(needed.length&&matchedCapabilities===0)return {score:0,capability:0,protocol:0,reputation:0,verification:agent.verified?1:0,reason:'no_required_capability_overlap'};
  const capabilityScore=needed.length?capabilitySimilarities.reduce((sum,score)=>sum+score,0)/needed.length:1;
  const preferred=task.preferredProtocols||[],protocols=new Set(agent.protocols||[]);
  const protocolScore=preferred.length?(preferred.some(x=>protocols.has(x))?1:0):1;
  const rating=Number(agent.reputation?.rating);
  const completed=Math.max(0,Number(agent.reputation?.completedTasks)||0);
  const disputed=Math.max(0,Number(agent.reputation?.disputedTasks)||0);
  const ratingScore=Number.isFinite(rating)&&rating>0?Math.min(1,rating/5):0.6;
  const reliabilityScore=completed+disputed>0?completed/(completed+disputed):0.75;
  const reputationScore=ratingScore*0.7+reliabilityScore*0.3;
  const verificationScore=agent.trustStatus==='verified'?1:agent.verified?0.8:0.4;
  const score=Math.round((capabilityScore*0.58+protocolScore*0.16+reputationScore*0.16+verificationScore*0.10)*100);
  return {score,capability:round2(capabilityScore),protocol:round2(protocolScore),reputation:round2(reputationScore),verification:round2(verificationScore),reason:'qualified'};
}

export function scoreMatch(agent,task){ return matchBreakdown(agent,task).score; }

export function transitionAllowed(from,to){
  const map={open:['accepted','cancelled'],accepted:['working','cancelled'],working:['delivered','cancelled'],delivered:['working','completed','disputed'],disputed:['completed','cancelled'],completed:[],cancelled:[]};
  return Boolean(map[from]?.includes(to));
}
export async function sha256(value){const data=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function safePublicAgent(agent){const {verified,...rest}=agent;return {...rest,verified:Boolean(verified)};}

function capabilitySimilarity(required,offered){
  const requiredWords=capabilityWords(required),offeredWords=capabilityWords(offered);
  if(!requiredWords.length||!offeredWords.length)return 0;
  if(requiredWords.join(' ')===offeredWords.join(' '))return 1;
  const offeredSet=new Set(offeredWords);
  const covered=requiredWords.filter(word=>offeredSet.has(word)).length;
  return covered/requiredWords.length;
}
function capabilityWords(value){return text(value,100).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)}
function text(v,max){return String(v??'').trim().slice(0,max)}
function unique(v,max){return [...new Set(Array.isArray(v)?v.map(x=>text(x,100).toLowerCase()).filter(Boolean):[])].slice(0,max)}
function uniqueText(v,maxItems,maxLength){return [...new Set(Array.isArray(v)?v.map(x=>text(x,maxLength)).filter(Boolean):[])].slice(0,maxItems)}
function finite(v){const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function cleanId(v){const x=text(v,200);return /^[A-Za-z0-9:_\-.]{3,200}$/.test(x)?x:null}
function safeHttpsUrl(v){try{const u=new URL(String(v||''));return u.protocol==='https:'?u.href:null}catch{return null}}
function round2(v){return Math.round(Number(v||0)*100)/100}
