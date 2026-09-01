import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing expected fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous fragment: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

await edit('cloudflare/src/repository.js', source => {
  source = replaceOnce(source,
    "import { normalizeAgent, normalizeTask, normalizeMessage, scoreMatch, transitionAllowed, sha256 } from '../../src/domain.js';",
    "import { normalizeAgent, normalizeTask, normalizeMessage, matchBreakdown, transitionAllowed, sha256 } from '../../src/domain.js';",
    'D1 domain import');

  source = replaceOnce(source,
`    await this.db.prepare(\`INSERT INTO tasks(id,title,description,requester_agent_id,provider_agent_id,required_capabilities_json,preferred_protocols_json,budget,currency,status,artifact_json,artifact_digest,delivery_note,dispute_reason,event_source,created_at,updated_at,accepted_at,started_at,delivered_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`).bind(t.id,t.title,t.description,t.requesterAgentId,null,j(t.requiredCapabilities),j(t.preferredProtocols),t.budget,t.currency,'open',null,null,null,null,cleanSource(source),t.createdAt,t.updatedAt,null,null,null,null).run();`,
`    await this.db.prepare(\`INSERT INTO tasks(id,title,description,acceptance_criteria_json,requester_agent_id,provider_agent_id,required_capabilities_json,preferred_protocols_json,budget,currency,status,artifact_json,artifact_digest,delivery_note,dispute_reason,event_source,created_at,updated_at,accepted_at,started_at,delivered_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`).bind(t.id,t.title,t.description,j(t.acceptanceCriteria),t.requesterAgentId,null,j(t.requiredCapabilities),j(t.preferredProtocols),t.budget,t.currency,'open',null,null,null,null,cleanSource(source),t.createdAt,t.updatedAt,null,null,null,null).run();`,
    'D1 task insert');

  source = replaceOnce(source,
`  async matches(taskId){const task=await this.mustTask(taskId),agents=await this.listAgents({available:'true'});return agents.filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,score:scoreMatch(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}

  async transition(taskId,to,actorId,input={},ctx={}){`,
`  async matches(taskId){const task=await this.mustTask(taskId),agents=await this.listAgents({available:'true'});return agents.filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,...matchBreakdown(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}

  async selectProvider(taskId,requesterAgentId,providerAgentId,{source='direct'}={}){
    const t=await this.mustTask(taskId);if(t.status!=='open')throw problem('task_must_be_open_for_provider_selection',409);
    if(!t.requesterAgentId||t.requesterAgentId!==requesterAgentId)throw problem('requester_mismatch',403);
    if(!providerAgentId||!await this.getAgent(providerAgentId))throw problem('provider_agent_not_found',404);
    if(providerAgentId===requesterAgentId)throw problem('self_assignment_not_allowed',409);
    if(await this.sameOperator(requesterAgentId,providerAgentId))throw problem('related_operator_assignment_not_allowed',409);
    const stamp=new Date().toISOString(),r=await this.db.prepare(\`UPDATE tasks SET selected_provider_agent_id=?,selected_at=?,updated_at=?,event_source=? WHERE id=? AND status='open'\`).bind(providerAgentId,stamp,stamp,cleanSource(source),taskId).run();
    if(changes(r)!==1)throw problem('task_state_changed_retry',409);return this.getTask(taskId);
  }

  async transition(taskId,to,actorId,input={},ctx={}){`,
    'D1 provider selection method');

  source = replaceOnce(source,
`    if(to==='accepted'){
      if(!actorId||!await this.getAgent(actorId))throw problem('provider_agent_not_found',404);if(actorId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);
      if(t.requesterAgentId&&await this.sameOperator(t.requesterAgentId,actorId))throw problem('related_operator_assignment_not_allowed',409);
      sql=\`UPDATE tasks SET status='accepted',provider_agent_id=?,accepted_at=?,updated_at=?,event_source=? WHERE id=? AND status='open'\`;params=[actorId,stamp,stamp,src,taskId];
    }else if(to==='working'){
      if(t.providerAgentId!==actorId)throw problem('provider_mismatch',403);const payment=await this.getTaskPayment(taskId);if(payment&&!['funded','held'].includes(payment.status))throw problem('payment_not_funded',409);sql=\`UPDATE tasks SET status='working',started_at=?,updated_at=?,event_source=? WHERE id=? AND status='accepted'\`;params=[stamp,stamp,src,taskId];`,
`    if(to==='accepted'){
      if(!actorId||!await this.getAgent(actorId))throw problem('provider_agent_not_found',404);if(actorId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);
      if(t.selectedProviderAgentId&&t.selectedProviderAgentId!==actorId)throw problem('provider_not_selected',403);
      if(t.requesterAgentId&&await this.sameOperator(t.requesterAgentId,actorId))throw problem('related_operator_assignment_not_allowed',409);
      sql=\`UPDATE tasks SET status='accepted',provider_agent_id=?,selected_provider_agent_id=COALESCE(selected_provider_agent_id,?),selected_at=COALESCE(selected_at,?),accepted_at=?,updated_at=?,event_source=? WHERE id=? AND status='open'\`;params=[actorId,actorId,stamp,stamp,stamp,src,taskId];
    }else if(to==='working'&&t.status==='delivered'){
      if(t.requesterAgentId&&t.requesterAgentId!==actorId)throw problem('requester_mismatch',403);const note=text(input.reason??input.note,2000)||'Revision requested';
      sql=\`UPDATE tasks SET status='working',revision_count=revision_count+1,revision_requested_at=?,last_revision_note=?,updated_at=?,event_source=? WHERE id=? AND status='delivered'\`;params=[stamp,note,stamp,src,taskId];
    }else if(to==='working'){
      if(t.providerAgentId!==actorId)throw problem('provider_mismatch',403);const payment=await this.getTaskPayment(taskId);if(payment&&!['funded','held'].includes(payment.status))throw problem('payment_not_funded',409);sql=\`UPDATE tasks SET status='working',started_at=COALESCE(started_at,?),updated_at=?,event_source=? WHERE id=? AND status='accepted'\`;params=[stamp,stamp,src,taskId];`,
    'D1 accept/start/revision transition');

  source = replaceOnce(source,
`function taskRow(r){return{id:r.id,title:r.title,description:r.description,requesterAgentId:r.requester_agent_id||null,providerAgentId:r.provider_agent_id||null,requiredCapabilities:p(r.required_capabilities_json,[]),preferredProtocols:p(r.preferred_protocols_json,[]),budget:r.budget==null?null:Number(r.budget),currency:r.currency,status:r.status,artifact:p(r.artifact_json,null),artifactDigest:r.artifact_digest||null,deliveryNote:r.delivery_note||null,disputeReason:r.dispute_reason||null,createdAt:r.created_at,updatedAt:r.updated_at,acceptedAt:r.accepted_at||null,startedAt:r.started_at||null,deliveredAt:r.delivered_at||null,completedAt:r.completed_at||null};}`,
`function taskRow(r){return{id:r.id,title:r.title,description:r.description,acceptanceCriteria:p(r.acceptance_criteria_json,[]),requesterAgentId:r.requester_agent_id||null,selectedProviderAgentId:r.selected_provider_agent_id||null,providerAgentId:r.provider_agent_id||null,requiredCapabilities:p(r.required_capabilities_json,[]),preferredProtocols:p(r.preferred_protocols_json,[]),budget:r.budget==null?null:Number(r.budget),currency:r.currency,status:r.status,artifact:p(r.artifact_json,null),artifactDigest:r.artifact_digest||null,deliveryNote:r.delivery_note||null,disputeReason:r.dispute_reason||null,revisionCount:n(r.revision_count),lastRevisionNote:r.last_revision_note||null,createdAt:r.created_at,updatedAt:r.updated_at,selectedAt:r.selected_at||null,acceptedAt:r.accepted_at||null,startedAt:r.started_at||null,deliveredAt:r.delivered_at||null,revisionRequestedAt:r.revision_requested_at||null,completedAt:r.completed_at||null};}`,
    'D1 task row');
  return source;
});

await edit('cloudflare/src/index.js', source => {
  source = replaceOnce(source,
    "m = url.pathname.match(/^\\/api\\/v1\\/tasks\\/([^/]+)(?:\\/(matches|accept|start|deliver|complete|dispute|cancel))?$/);",
    "m = url.pathname.match(/^\\/api\\/v1\\/tasks\\/([^/]+)(?:\\/(matches|select|accept|start|deliver|revise|complete|dispute|cancel))?$/);",
    'Cloudflare task action regex');
  source = replaceOnce(source,
`          if (action === 'accept') {
            await requireAgent(request, repo, body.providerAgentId);`,
`          if (action === 'select') {
            await requireAgent(request, repo, body.requesterAgentId);
            return { status: 200, payload: { task: await repo.selectProvider(taskId, body.requesterAgentId, body.providerAgentId, { source }) } };
          }
          if (action === 'accept') {
            await requireAgent(request, repo, body.providerAgentId);`,
    'Cloudflare select action');
  source = replaceOnce(source,
`          if (action === 'complete') {
            await requireAgent(request, repo, body.requesterAgentId);`,
`          if (action === 'revise') {
            await requireAgent(request, repo, body.requesterAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'working', body.requesterAgentId, body, { source }) } };
          }
          if (action === 'complete') {
            await requireAgent(request, repo, body.requesterAgentId);`,
    'Cloudflare revise action');
  return source;
});

await edit('src/store.js', source => {
  source = replaceOnce(source,
    "import { id, now, normalizeAgent, normalizeTask, normalizeMessage, scoreMatch, transitionAllowed, sha256 } from './domain.js';",
    "import { id, now, normalizeAgent, normalizeTask, normalizeMessage, matchBreakdown, transitionAllowed, sha256 } from './domain.js';",
    'local domain import');
  source = replaceOnce(source,
`export function matches(taskId){const task=mustTask(taskId);return listAgents({available:'true'}).filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,score:scoreMatch(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}
export async function acceptTask(taskId,providerAgentId,ctx={}){const t=mustTask(taskId);if(!getRawAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);move(t,'accepted');t.providerAgentId=providerAgentId;t.acceptedAt=now();audit('task.accepted',{taskId,providerAgentId,source:ctx.source});count('task.accepted',ctx.source);await persist();return t;}`,
`export function matches(taskId){const task=mustTask(taskId);return listAgents({available:'true'}).filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,...matchBreakdown(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}
export async function selectProvider(taskId,requesterAgentId,providerAgentId,ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);if(t.status!=='open')throw problem('task_must_be_open_for_provider_selection',409);if(!getRawAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===requesterAgentId)throw problem('self_assignment_not_allowed',409);t.selectedProviderAgentId=providerAgentId;t.selectedAt=now();t.updatedAt=now();audit('task.provider_selected',{taskId,requesterAgentId,providerAgentId,source:ctx.source});count('task.provider_selected',ctx.source);await persist();return t;}
export async function acceptTask(taskId,providerAgentId,ctx={}){const t=mustTask(taskId);if(!getRawAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);if(t.selectedProviderAgentId&&t.selectedProviderAgentId!==providerAgentId)throw problem('provider_not_selected',403);move(t,'accepted');t.selectedProviderAgentId??=providerAgentId;t.selectedAt??=now();t.providerAgentId=providerAgentId;t.acceptedAt=now();audit('task.accepted',{taskId,providerAgentId,source:ctx.source});count('task.accepted',ctx.source);await persist();return t;}`,
    'local matching/selection');
  source = replaceOnce(source,
`export async function deliverTask(taskId,providerAgentId,input={},ctx={}){const t=mustProvider(taskId,providerAgentId);move(t,'delivered');t.artifact=input.artifact??null;t.artifactDigest=await sha256(input.artifact??'');t.deliveryNote=String(input.note||'').slice(0,2000)||null;t.deliveredAt=now();audit('task.delivered',{taskId,providerAgentId,artifactDigest:t.artifactDigest,source:ctx.source});count('task.delivered',ctx.source);await persist();return t;}
export async function completeTask`,
`export async function deliverTask(taskId,providerAgentId,input={},ctx={}){const t=mustProvider(taskId,providerAgentId);move(t,'delivered');t.artifact=input.artifact??null;t.artifactDigest=await sha256(input.artifact??'');t.deliveryNote=String(input.note||'').slice(0,2000)||null;t.deliveredAt=now();audit('task.delivered',{taskId,providerAgentId,artifactDigest:t.artifactDigest,source:ctx.source});count('task.delivered',ctx.source);await persist();return t;}
export async function reviseTask(taskId,requesterAgentId,input={},ctx={}){const t=mustTask(taskId);authorizeRequester(t,requesterAgentId);if(t.status!=='delivered')throw problem('task_must_be_delivered_for_revision',409);move(t,'working');t.revisionCount=Number(t.revisionCount||0)+1;t.revisionRequestedAt=now();t.lastRevisionNote=String(input.reason||input.note||'Revision requested').slice(0,2000);audit('task.revision_requested',{taskId,requesterAgentId,providerAgentId:t.providerAgentId,revisionCount:t.revisionCount,source:ctx.source});count('task.revision_requested',ctx.source);await persist();return t;}
export async function completeTask`,
    'local revision action');
  return source;
});

await edit('src/server.js', source => {
  source = replaceOnce(source,
    'createTask,matches,acceptTask,startTask,deliverTask,completeTask,disputeTask,cancelTask',
    'createTask,matches,selectProvider,acceptTask,startTask,deliverTask,reviseTask,completeTask,disputeTask,cancelTask',
    'local server imports');
  source = replaceOnce(source,
    "const tm=url.pathname.match(/^\\/api\\/v1\\/tasks\\/([^/]+)(?:\\/(matches|accept|start|deliver|complete|dispute|cancel))?$/);",
    "const tm=url.pathname.match(/^\\/api\\/v1\\/tasks\\/([^/]+)(?:\\/(matches|select|accept|start|deliver|revise|complete|dispute|cancel))?$/);",
    'local task action regex');
  source = replaceOnce(source,
    "return await mutation(req,res,url,source,async b=>{if(action==='accept'){",
    "return await mutation(req,res,url,source,async b=>{if(action==='select'){await requireAgent(req,b.requesterAgentId);return{status:200,payload:{task:await selectProvider(taskId,b.requesterAgentId,b.providerAgentId,{source})}}}if(action==='accept'){",
    'local select action');
  source = replaceOnce(source,
    "if(action==='complete'){await requireAgent(req,b.requesterAgentId);",
    "if(action==='revise'){await requireAgent(req,b.requesterAgentId);return{status:200,payload:{task:await reviseTask(taskId,b.requesterAgentId,b,{source})}}}if(action==='complete'){await requireAgent(req,b.requesterAgentId);",
    'local revise action');
  return source;
});

await edit('public/index.html', source => replaceOnce(source,
  '<label class="span-2">Description<textarea name="description" required maxlength="5000" placeholder="What should be delivered? What does success look like?"></textarea></label><label>Required capabilities',
  '<label class="span-2">Description<textarea name="description" required maxlength="5000" placeholder="What should be delivered? What does success look like?"></textarea></label><label class="span-2">Acceptance criteria<textarea name="acceptanceCriteria" maxlength="3000" placeholder="One criterion per line — e.g. No P0 findings\\nReturn JSON and a concise report\\nInclude artifact references"></textarea><small>Write observable conditions the requester can use to accept delivery or request a revision.</small></label><label>Required capabilities',
  'requester acceptance criteria field'));

await edit('public/app.js', source => {
  source = replaceOnce(source,
    "      title: form.get('title'), description: form.get('description'), requesterAgentId,\n      requiredCapabilities:",
    "      title: form.get('title'), description: form.get('description'), acceptanceCriteria: splitLines(form.get('acceptanceCriteria')), requesterAgentId,\n      requiredCapabilities:",
    'task submit acceptance criteria');
  source = replaceOnce(source,
    "function split(value) { return [...new Set(String(value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))]; }",
    "function split(value) { return [...new Set(String(value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))]; }\nfunction splitLines(value) { return [...new Set(String(value || '').split(/\\r?\\n/).map(x => x.trim()).filter(Boolean))].slice(0,20); }",
    'splitLines helper');
  return source;
});

console.log('TaskBay launch-loop codemod applied successfully.');
