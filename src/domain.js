export const VERSION = '0.12.0';
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
    requesterAgentId:cleanId(input.requesterAgentId)||null,
    providerAgentId:null,
    requiredCapabilities:unique(input.requiredCapabilities,50),
    preferredProtocols:unique(input.preferredProtocols,10).filter(x=>PROTOCOLS.includes(x)),
    budget:finite(input.budget),currency:text(input.currency,8)||'USD',
    status:'open',artifact:null,artifactDigest:null,deliveryNote:null,disputeReason:null,
    createdAt:now(),updatedAt:now(),acceptedAt:null,startedAt:null,deliveredAt:null,completedAt:null
  };
}

export function normalizeMessage(taskId,input={}){
  return {id:id('msg'),taskId,fromAgentId:cleanId(input.fromAgentId)||null,toAgentId:cleanId(input.toAgentId)||null,type:MESSAGE_TYPES.includes(input.type)?input.type:'note',body:text(input.body,4000),createdAt:now()};
}

export function scoreMatch(agent,task){
  if(!agent.availability)return 0;
  const needed=new Set(task.requiredCapabilities||[]),caps=new Set(agent.capabilities||[]);
  const capabilityScore=needed.size?[...needed].filter(x=>caps.has(x)).length/needed.size:1;
  const preferred=task.preferredProtocols||[],protocols=new Set(agent.protocols||[]);
  const protocolScore=preferred.length?(preferred.some(x=>protocols.has(x))?1:0):1;
  const reputation=agent.reputation?.rating?agent.reputation.rating/5:0.6;
  return Math.round((capabilityScore*0.65+protocolScore*0.2+reputation*0.15)*100);
}

export function transitionAllowed(from,to){
  const map={open:['accepted','cancelled'],accepted:['working','cancelled'],working:['delivered','cancelled'],delivered:['completed','disputed'],disputed:['completed','cancelled'],completed:[],cancelled:[]};
  return Boolean(map[from]?.includes(to));
}
export async function sha256(value){const data=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function safePublicAgent(agent){const {verified,...rest}=agent;return {...rest,verified:Boolean(verified)};}

function text(v,max){return String(v??'').trim().slice(0,max)}
function unique(v,max){return [...new Set(Array.isArray(v)?v.map(x=>text(x,100).toLowerCase()).filter(Boolean):[])].slice(0,max)}
function finite(v){const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function cleanId(v){const x=text(v,200);return /^[A-Za-z0-9:_\-.]{3,200}$/.test(x)?x:null}
function safeHttpsUrl(v){try{const u=new URL(String(v||''));return u.protocol==='https:'?u.href:null}catch{return null}}
