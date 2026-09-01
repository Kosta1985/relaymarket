import { normalizeAgent, normalizeTask, normalizeMessage, scoreMatch, transitionAllowed, sha256 } from '../../src/domain.js';
import { PLATFORM_FEE_BPS, normalizePayment, paymentTransitionAllowed } from '../../src/payments.js';

const ACTIVE_STATES=['accepted','working','delivered','disputed'];

export class D1Repository {
  constructor(db){if(!db)throw problem('d1_not_bound',503);this.db=db;}

  async listAgents(filters={}){
    const conditions=[],params=[];
    if(filters.includeUnverified!==true)conditions.push('a.verified=1');
    if(filters.available==='true'){conditions.push('a.availability=1');}
    const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
    const out=await this.db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM reviews r WHERE r.agent_id=a.id) AS review_count,
      (SELECT AVG(rating) FROM reviews r WHERE r.agent_id=a.id) AS rating,
      (SELECT COUNT(*) FROM tasks t WHERE t.provider_agent_id=a.id AND t.status='completed') AS completed_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.provider_agent_id=a.id AND t.status='disputed') AS disputed_tasks
      FROM agents a ${where} ORDER BY a.updated_at DESC LIMIT 200`).bind(...params).all();
    let rows=(out.results||[]).map(agentRow);
    if(filters.capability)rows=rows.filter(a=>a.capabilities.includes(String(filters.capability).toLowerCase()));
    if(filters.protocol)rows=rows.filter(a=>a.protocols.includes(String(filters.protocol).toLowerCase()));
    return rows;
  }

  async getAgent(id){const row=await this.db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM reviews r WHERE r.agent_id=a.id) AS review_count,
      (SELECT AVG(rating) FROM reviews r WHERE r.agent_id=a.id) AS rating,
      (SELECT COUNT(*) FROM tasks t WHERE t.provider_agent_id=a.id AND t.status='completed') AS completed_tasks,
      (SELECT COUNT(*) FROM tasks t WHERE t.provider_agent_id=a.id AND t.status='disputed') AS disputed_tasks
      FROM agents a WHERE a.id=?`).bind(id).first();return row?agentRow(row):null;}

  async createAgent(input,{source='direct'}={}){
    const a=normalizeAgent(input),src=cleanSource(source);
    try{await this.db.prepare(`INSERT INTO agents(id,name,description,capabilities_json,protocols_json,endpoints_json,pricing_json,availability,verified,verified_at,event_source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(a.id,a.name,a.description,j(a.capabilities),j(a.protocols),j(a.endpoints),j(a.pricing),a.availability?1:0,0,null,src,a.createdAt,a.updatedAt).run();}
    catch(e){if(isUnique(e))throw problem('agent_id_exists',409);throw e;}
    return this.getAgent(a.id);
  }

  async registerAgent(input,{source='direct'}={}){
    const a=normalizeAgent(input),src=cleanSource(source),keyId=randomHex(8),apiKey=`rmk_${keyId}_${randomB64(24)}`,credentialId=`cred_${keyId}`,keyHash=await hash(apiKey);
    try{
      await this.db.batch([
        this.db.prepare(`INSERT INTO agents(id,name,description,capabilities_json,protocols_json,endpoints_json,pricing_json,availability,verified,verified_at,event_source,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(a.id,a.name,a.description,j(a.capabilities),j(a.protocols),j(a.endpoints),j(a.pricing),a.availability?1:0,0,null,src,a.createdAt,a.updatedAt),
        this.db.prepare('INSERT INTO agent_credentials(id,agent_id,key_hash,created_at) VALUES(?,?,?,?)').bind(credentialId,a.id,keyHash,a.createdAt)
      ]);
    }catch(e){if(isUnique(e))throw problem('agent_id_exists',409);throw e;}
    return{agent:await this.getAgent(a.id),credential:{apiKey,credentialId,agentId:a.id}};
  }

  async updateAgent(id,input,{source='direct'}={}){
    const old=await this.getAgent(id);if(!old)throw problem('agent_not_found',404);
    const a=normalizeAgent({...old,...input,id:old.id,createdAt:old.createdAt});
    const r=await this.db.prepare(`UPDATE agents SET name=?,description=?,capabilities_json=?,protocols_json=?,endpoints_json=?,pricing_json=?,availability=?,event_source=?,updated_at=? WHERE id=?`)
      .bind(a.name,a.description,j(a.capabilities),j(a.protocols),j(a.endpoints),j(a.pricing),a.availability?1:0,cleanSource(source),a.updatedAt,id).run();
    if(changes(r)!==1)throw problem('agent_not_found',404);return this.getAgent(id);
  }

  async listTasks(status='all'){
    const out=status==='all'?await this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 300').all():await this.db.prepare('SELECT * FROM tasks WHERE status=? ORDER BY created_at DESC LIMIT 300').bind(status).all();
    return (out.results||[]).map(taskRow);
  }
  async getTask(id){const row=await this.db.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();return row?taskRow(row):null;}
  async createTask(input,{source='direct'}={}){
    if(input.requesterAgentId&&!await this.getAgent(input.requesterAgentId))throw problem('requester_agent_not_found',404);
    const t=normalizeTask(input);
    await this.db.prepare(`INSERT INTO tasks(id,title,description,acceptance_criteria_json,requester_agent_id,provider_agent_id,required_capabilities_json,preferred_protocols_json,budget,currency,status,artifact_json,artifact_digest,delivery_note,dispute_reason,event_source,created_at,updated_at,accepted_at,started_at,delivered_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(t.id,t.title,t.description,j(t.acceptanceCriteria),t.requesterAgentId,null,j(t.requiredCapabilities),j(t.preferredProtocols),t.budget,t.currency,'open',null,null,null,null,cleanSource(source),t.createdAt,t.updatedAt,null,null,null,null).run();
    return this.getTask(t.id);
  }
  async matches(taskId){const task=await this.mustTask(taskId),agents=await this.listAgents({available:'true'});return agents.filter(a=>a.id!==task.requesterAgentId).map(agent=>({agent,score:scoreMatch(agent,task)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);}
  async selectProvider(taskId,requesterAgentId,providerAgentId,{source='direct'}={}){const t=await this.mustTask(taskId);if(t.status!=='open')throw problem('task_must_be_open_for_provider_selection',409);if(!t.requesterAgentId||t.requesterAgentId!==requesterAgentId)throw problem('requester_mismatch',403);if(!providerAgentId||!await this.getAgent(providerAgentId))throw problem('provider_agent_not_found',404);if(providerAgentId===requesterAgentId)throw problem('self_assignment_not_allowed',409);if(await this.sameOperator(requesterAgentId,providerAgentId))throw problem('related_operator_assignment_not_allowed',409);const stamp=new Date().toISOString(),r=await this.db.prepare(`UPDATE tasks SET selected_provider_agent_id=?,selected_at=?,updated_at=?,event_source=? WHERE id=? AND status='open'`).bind(providerAgentId,stamp,stamp,cleanSource(source),taskId).run();if(changes(r)!==1)throw problem('task_state_changed_retry',409);return this.getTask(taskId);}

  async transition(taskId,to,actorId,input={},ctx={}){
    const t=await this.mustTask(taskId);if(!transitionAllowed(t.status,to))throw problem(`invalid_transition_${t.status}_to_${to}`,409);
    const src=cleanSource(ctx.source),stamp=new Date().toISOString();let sql,params,protectionOpen=null;
    if(to==='accepted'){
      if(!actorId||!await this.getAgent(actorId))throw problem('provider_agent_not_found',404);if(actorId===t.requesterAgentId)throw problem('self_assignment_not_allowed',409);if(t.selectedProviderAgentId&&t.selectedProviderAgentId!==actorId)throw problem('provider_not_selected',403);
      if(t.requesterAgentId&&await this.sameOperator(t.requesterAgentId,actorId))throw problem('related_operator_assignment_not_allowed',409);
      sql=`UPDATE tasks SET status='accepted',provider_agent_id=?,accepted_at=?,updated_at=?,event_source=? WHERE id=? AND status='open'`;params=[actorId,stamp,stamp,src,taskId];
    }else if(to==='working'&&t.status==='delivered'){
      if(t.requesterAgentId&&t.requesterAgentId!==actorId)throw problem('requester_mismatch',403);const note=text(input.reason??input.note,2000)||'Revision requested';sql=`UPDATE tasks SET status='working',revision_count=revision_count+1,revision_requested_at=?,last_revision_note=?,updated_at=?,event_source=? WHERE id=? AND status='delivered'`;params=[stamp,note,stamp,src,taskId];
    }else if(to==='working'){
      if(t.providerAgentId!==actorId)throw problem('provider_mismatch',403);const payment=await this.getTaskPayment(taskId);if(payment&&!['funded','held'].includes(payment.status))throw problem('payment_not_funded',409);sql=`UPDATE tasks SET status='working',started_at=COALESCE(started_at,?),updated_at=?,event_source=? WHERE id=? AND status='accepted'`;params=[stamp,stamp,src,taskId];
    }else if(to==='delivered'){
      if(t.providerAgentId!==actorId)throw problem('provider_mismatch',403);const digest=await sha256(input.artifact??'');sql=`UPDATE tasks SET status='delivered',artifact_json=?,artifact_digest=?,delivery_note=?,delivered_at=?,updated_at=?,event_source=? WHERE id=? AND status='working'`;params=[j(input.artifact??null),digest,text(input.note,2000)||null,stamp,stamp,src,taskId];
    }else if(to==='completed'){
      if(t.requesterAgentId&&t.requesterAgentId!==actorId)throw problem('requester_mismatch',403);sql=`UPDATE tasks SET status='completed',completed_at=?,updated_at=?,event_source=? WHERE id=? AND status IN('delivered','disputed')`;params=[stamp,stamp,src,taskId];
    }else if(to==='disputed'){
      if(t.requesterAgentId&&t.requesterAgentId!==actorId)throw problem('requester_mismatch',403);const payment=await this.getTaskPayment(taskId),messages=await this.db.prepare('SELECT COUNT(*) c FROM task_messages WHERE task_id=?').bind(taskId).first();
      protectionOpen={id:uid('protect'),payment,reason:text(input.reason,1000)||'unspecified',snapshot:j({taskId,statusBefore:t.status,requesterAgentId:t.requesterAgentId,providerAgentId:t.providerAgentId,artifactDigest:t.artifactDigest,deliveredAt:t.deliveredAt,messageCount:n(messages?.c),paymentId:payment?.id||null,paymentStatus:payment?.status||null})};
      sql=`UPDATE tasks SET status='disputed',dispute_reason=?,updated_at=?,event_source=? WHERE id=? AND status='delivered'`;params=[protectionOpen.reason,stamp,src,taskId];
    }else if(to==='cancelled'){
      if(t.status==='disputed'&&t.requesterAgentId&&actorId!==t.requesterAgentId)throw problem('requester_required_to_cancel_dispute',403);if(t.requesterAgentId&&actorId!==t.requesterAgentId&&actorId!==t.providerAgentId)throw problem('actor_not_authorized',403);sql=`UPDATE tasks SET status='cancelled',updated_at=?,event_source=? WHERE id=? AND status IN('open','accepted','working','disputed')`;params=[stamp,src,taskId];
    }
    let r;
    if(to==='disputed'&&protectionOpen){
      const stmts=[this.db.prepare(sql).bind(...params)];
      if(protectionOpen.payment?.status==='funded')stmts.push(this.db.prepare(`UPDATE payments SET status='held',held_at=?,updated_at=?,event_source=? WHERE id=? AND status='funded'`).bind(stamp,stamp,src,protectionOpen.payment.id));
      stmts.push(this.db.prepare(`INSERT OR IGNORE INTO payment_protection_cases(id,task_id,payment_id,opened_by_agent_id,status,reason,snapshot_json,created_at,updated_at) VALUES(?,?,?,?, 'open',?,?,?,?)`).bind(protectionOpen.id,taskId,protectionOpen.payment?.id||null,actorId,protectionOpen.reason,protectionOpen.snapshot,stamp,stamp));
      const result=await this.db.batch(stmts);r=result[0];
    }else if(to==='completed'&&t.providerAgentId&&input.rating){
      const stmts=[this.db.prepare(sql).bind(...params),this.db.prepare(`INSERT OR IGNORE INTO reviews(id,agent_id,task_id,rating,comment,created_at) VALUES(?,?,?,?,?,?)`).bind(uid('rev'),t.providerAgentId,taskId,clampRating(input.rating),text(input.comment,1000),stamp)];
      if(t.status==='disputed')stmts.push(this.db.prepare(`UPDATE payment_protection_cases SET status='resolved_release',resolution_note='requester accepted disputed delivery',resolved_at=?,updated_at=? WHERE task_id=? AND status IN('open','evidence','review')`).bind(stamp,stamp,taskId));
      const result=await this.db.batch(stmts);r=result[0];
    }else if(to==='completed'&&t.status==='disputed'){
      const result=await this.db.batch([this.db.prepare(sql).bind(...params),this.db.prepare(`UPDATE payment_protection_cases SET status='resolved_release',resolution_note='requester accepted disputed delivery',resolved_at=?,updated_at=? WHERE task_id=? AND status IN('open','evidence','review')`).bind(stamp,stamp,taskId)]);r=result[0];
    }else r=await this.db.prepare(sql).bind(...params).run();
    if(changes(r)!==1)throw problem('task_state_changed_retry',409);
    return this.getTask(taskId);
  }

  async listMessages(taskId){await this.mustTask(taskId);const out=await this.db.prepare('SELECT * FROM task_messages WHERE task_id=? ORDER BY created_at ASC LIMIT 500').bind(taskId).all();return(out.results||[]).map(messageRow);}
  async createMessage(taskId,input,{source='direct'}={}){
    const t=await this.mustTask(taskId),participants=[t.requesterAgentId,t.providerAgentId].filter(Boolean);if(!input.fromAgentId)throw problem('from_agent_required',400);if(!participants.includes(input.fromAgentId))throw problem('sender_not_task_participant',403);if(input.toAgentId&&!participants.includes(input.toAgentId))throw problem('recipient_not_task_participant',403);
    const m=normalizeMessage(taskId,input);if(!m.body)throw problem('message_body_required',400);await this.db.prepare(`INSERT INTO task_messages(id,task_id,from_agent_id,to_agent_id,type,body,event_source,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(m.id,m.taskId,m.fromAgentId,m.toAgentId,m.type,m.body,cleanSource(source),m.createdAt).run();return m;
  }

  async stats(){
    const [a,t,m,r,trust]=await this.db.batch([
      this.db.prepare(`SELECT COUNT(*) agents,SUM(CASE WHEN availability=1 THEN 1 ELSE 0 END) available FROM agents`),
      this.db.prepare(`SELECT COUNT(*) tasks,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open_tasks,SUM(CASE WHEN status IN('accepted','working','delivered','disputed') THEN 1 ELSE 0 END) active_tasks,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_tasks,SUM(CASE WHEN status='completed' AND trust_eligible=1 THEN 1 ELSE 0 END) qualified_completed_tasks FROM tasks`),
      this.db.prepare(`SELECT COUNT(*) messages FROM task_messages`),
      this.db.prepare(`SELECT COUNT(*) repeat_providers FROM (SELECT provider_agent_id FROM tasks WHERE status='completed' AND trust_eligible=1 AND provider_agent_id IS NOT NULL GROUP BY provider_agent_id HAVING COUNT(*)>1)`),
      this.db.prepare(`SELECT (SELECT COUNT(*) FROM operators WHERE operator_verified_at IS NOT NULL AND (operator_verification_expires_at IS NULL OR julianday(operator_verification_expires_at) > julianday('now'))) verified_operators,(SELECT COUNT(*) FROM agents WHERE trust_status='verified') verified_agents,(SELECT COUNT(*) FROM payments p JOIN tasks t ON t.id=p.task_id WHERE p.status='released' AND t.status='completed' AND t.trust_eligible=1) verified_paid_transactions`)
    ]);
    const counters=await this.totalCounters();const ar=a.results?.[0]||{},tr=t.results?.[0]||{},trustRow=trust.results?.[0]||{};return{agents:n(ar.agents),availableAgents:n(ar.available),verifiedAgents:n(trustRow.verified_agents),verifiedOperators:n(trustRow.verified_operators),verifiedPaidTransactions:n(trustRow.verified_paid_transactions),tasks:n(tr.tasks),openTasks:n(tr.open_tasks),activeTasks:n(tr.active_tasks),completedTasks:n(tr.completed_tasks),qualifiedCompletedTasks:n(tr.qualified_completed_tasks),repeatProviders:n(r.results?.[0]?.repeat_providers),messages:n(m.results?.[0]?.messages),counters};
  }
  async launchKpis(){
    const summary=await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM agents WHERE verified=1) endpoint_verified_agents,
      (SELECT COUNT(DISTINCT operator_id) FROM agents WHERE verified=1 AND operator_id IS NOT NULL) independent_verified_operators,
      (SELECT COUNT(*) FROM tasks WHERE status='open') open_tasks,
      (SELECT COUNT(*) FROM tasks WHERE selected_provider_agent_id IS NOT NULL) selected_tasks,
      (SELECT COUNT(*) FROM tasks WHERE selected_provider_agent_id IS NOT NULL AND accepted_at IS NOT NULL) selected_accepted_tasks,
      (SELECT COUNT(*) FROM tasks WHERE accepted_at IS NOT NULL) accepted_tasks,
      (SELECT COUNT(*) FROM tasks WHERE delivered_at IS NOT NULL) delivered_tasks,
      (SELECT COUNT(*) FROM tasks WHERE completed_at IS NOT NULL) completed_tasks,
      (SELECT COUNT(*) FROM (SELECT requester_agent_id FROM tasks WHERE completed_at IS NOT NULL AND trust_eligible=1 AND requester_agent_id IS NOT NULL GROUP BY requester_agent_id HAVING COUNT(*)>1)) repeat_requesters,
      (SELECT COUNT(*) FROM (SELECT provider_agent_id FROM tasks WHERE completed_at IS NOT NULL AND trust_eligible=1 AND provider_agent_id IS NOT NULL GROUP BY provider_agent_id HAVING COUNT(*)>1)) repeat_providers`).first();
    const timingRows=(await this.db.prepare(`SELECT created_at,selected_at,accepted_at,delivered_at,completed_at FROM tasks WHERE selected_at IS NOT NULL OR accepted_at IS NOT NULL OR delivered_at IS NOT NULL OR completed_at IS NOT NULL ORDER BY created_at DESC LIMIT 5000`).all()).results||[];
    const metricData=await this.metrics(),totals=metricData.totals||{},selected=n(summary?.selected_tasks),selectedAccepted=n(summary?.selected_accepted_tasks),accepted=n(summary?.accepted_tasks),delivered=n(summary?.delivered_tasks),completed=n(summary?.completed_tasks),disputes=n(totals['task.disputed']);
    const acquisitionSources=Object.entries(metricData.bySource||{}).map(([source,values])=>({source,agentRegistrations:n(values?.['agent.registered']),taskCreations:n(values?.['task.created']),matchRequests:n(values?.['match.requested']),providerSelections:n(values?.['task.provider_selected'])})).filter(row=>row.agentRegistrations||row.taskCreations||row.matchRequests||row.providerSelections).sort((a,b)=>(b.agentRegistrations+b.taskCreations+b.matchRequests+b.providerSelections)-(a.agentRegistrations+a.taskCreations+a.matchRequests+a.providerSelections));
    return{contractVersion:'launch-v1',endpointVerifiedAgents:n(summary?.endpoint_verified_agents),independentVerifiedOperators:n(summary?.independent_verified_operators),openTasks:n(summary?.open_tasks),providerSelections:selected,acceptedTasks:accepted,deliveredTasks:delivered,completedTasks:completed,repeatRequesters:n(summary?.repeat_requesters),repeatProviders:n(summary?.repeat_providers),matchRequests:n(totals['match.requested']),disputeEvents:disputes,conversion:{selectionToAccept:kpiRatio(selectedAccepted,selected),acceptToDeliver:kpiRatio(delivered,accepted),deliverToComplete:kpiRatio(completed,delivered),deliveredToDispute:kpiRatio(disputes,delivered)},medianMinutes:{createToSelection:kpiMedian(timingRows,'created_at','selected_at'),selectionToAccept:kpiMedian(timingRows,'selected_at','accepted_at'),acceptToDeliver:kpiMedian(timingRows,'accepted_at','delivered_at'),createToCompletion:kpiMedian(timingRows,'created_at','completed_at')},acquisitionSources,definitions:{independentVerifiedOperators:'Distinct linked operators represented by endpoint-verified agents. Agents without an operator link are not counted as independently verified operators.',matchRequests:'Requests to the ranking surface, not unique users and not guaranteed qualified matches.',disputeEvents:'Successful task.disputed lifecycle events. A later resolution does not erase the historical dispute event.',conversion:'Observed persisted task timestamps only; null when the denominator is zero.'}};
  }
  async metrics(){
    const out=await this.db.prepare('SELECT day,metric,source,count FROM marketplace_daily_counters ORDER BY day DESC,metric,source LIMIT 5000').all(),totals={},bySource={},daily={};
    for(const row of out.results||[]){const c=n(row.count);if(row.source==='all'){totals[row.metric]=(totals[row.metric]||0)+c;daily[row.day]??={};daily[row.day][row.metric]=(daily[row.day][row.metric]||0)+c;}else{bySource[row.source]??={};bySource[row.source][row.metric]=(bySource[row.source][row.metric]||0)+c;}}
    return{totals,bySource,daily};
  }
  async totalCounters(){return (await this.metrics()).totals;}
  async recentEvents(limit=30){const lim=Math.max(1,Math.min(100,Number(limit)||30)),out=await this.db.prepare('SELECT * FROM marketplace_events ORDER BY created_at DESC LIMIT ?').bind(lim).all();return(out.results||[]).map(eventRow);}
  async recordMetric(metric,{source='direct',detail={},audit=true}={}){
    const stamp=new Date().toISOString(),src=cleanSource(source),day=stamp.slice(0,10),stmts=[];
    if(audit)stmts.push(this.db.prepare(`INSERT INTO marketplace_events(id,event_type,source,detail_json,created_at) VALUES(?,?,?,?,?)`).bind(uid('evt'),metric,src,j(detail),stamp));
    stmts.push(counterStmt(this.db,day,metric,'all'),counterStmt(this.db,day,metric,src));await this.db.batch(stmts);
  }

  async issueCredential(agentId,{source='direct'}={}){if(!await this.getAgent(agentId))throw problem('agent_not_found',404);const keyId=randomHex(8),apiKey=`rmk_${keyId}_${randomB64(24)}`,credentialId=`cred_${keyId}`,stamp=new Date().toISOString();await this.db.prepare('INSERT INTO agent_credentials(id,agent_id,key_hash,created_at) VALUES(?,?,?,?)').bind(credentialId,agentId,await hash(apiKey),stamp).run();return{apiKey,credentialId,agentId};}
  async authenticateApiKey(apiKey){if(!apiKey||!String(apiKey).startsWith('rmk_'))return null;const keyHash=await hash(String(apiKey)),row=await this.db.prepare('SELECT id,agent_id FROM agent_credentials WHERE key_hash=? AND revoked_at IS NULL').bind(keyHash).first();if(!row)return null;await this.db.prepare('UPDATE agent_credentials SET last_used_at=? WHERE id=?').bind(new Date().toISOString(),row.id).run();return row.agent_id;}
  async listCredentials(agentId){if(!await this.getAgent(agentId))throw problem('agent_not_found',404);const out=await this.db.prepare('SELECT id,agent_id,created_at,last_used_at,revoked_at FROM agent_credentials WHERE agent_id=? ORDER BY created_at DESC').bind(agentId).all();return(out.results||[]).map(r=>({id:r.id,agentId:r.agent_id,createdAt:r.created_at,lastUsedAt:r.last_used_at,revokedAt:r.revoked_at,active:!r.revoked_at}));}
  async rotateCredential(agentId,credentialId,{source='direct'}={}){
    const old=await this.db.prepare('SELECT id FROM agent_credentials WHERE id=? AND agent_id=? AND revoked_at IS NULL').bind(credentialId,agentId).first();
    if(!old)throw problem('credential_not_found',404);
    const keyId=randomHex(8),apiKey=`rmk_${keyId}_${randomB64(24)}`,nextId=`cred_${keyId}`,stamp=new Date().toISOString(),keyHash=await hash(apiKey);
    const results=await this.db.batch([
      this.db.prepare('INSERT INTO agent_credentials(id,agent_id,key_hash,created_at) VALUES(?,?,?,?)').bind(nextId,agentId,keyHash,stamp),
      this.db.prepare("UPDATE agent_credentials SET revoked_at=?,revocation_reason='rotated' WHERE id=? AND agent_id=? AND revoked_at IS NULL").bind(stamp,credentialId,agentId)
    ]);
    if(changes(results[1])!==1)throw problem('credential_rotation_conflict',409);
    return{apiKey,credentialId:nextId,agentId};
  }
  async revokeCredential(agentId,credentialId,{source='direct'}={}){
    const active=await this.db.prepare('SELECT COUNT(*) n FROM agent_credentials WHERE agent_id=? AND revoked_at IS NULL').bind(agentId).first();
    if(n(active?.n)<=1)throw problem('cannot_revoke_last_active_credential',409);
    const stamp=new Date().toISOString(),r=await this.db.prepare("UPDATE agent_credentials SET revoked_at=?,revocation_reason='revoked' WHERE id=? AND agent_id=? AND revoked_at IS NULL").bind(stamp,credentialId,agentId).run();
    if(changes(r)!==1)throw problem('credential_not_found',404);
    return{credentialId,agentId,revokedAt:stamp};
  }


  async createVerificationChallenge(agentId,endpointIndex=0,{source='direct'}={}){
    const agent=await this.getAgent(agentId);if(!agent)throw problem('agent_not_found',404);const endpoint=agent.endpoints?.[Number(endpointIndex)];if(!endpoint)throw problem('endpoint_not_found',404);
    const token=`rm_verify_${randomB64(24)}`,stamp=new Date().toISOString(),expires=new Date(Date.now()+15*60_000).toISOString(),origin=new URL(endpoint.url).origin,challenge={id:uid('vfy'),agentId,endpointUrl:endpoint.url,verificationUrl:`${origin}/.well-known/relaymarket-verification.txt`,token,createdAt:stamp,expiresAt:expires,completedAt:null};
    await this.db.prepare('DELETE FROM agent_verification_challenges WHERE agent_id=? AND completed_at IS NULL').bind(agentId).run();
    await this.db.prepare(`INSERT INTO agent_verification_challenges(id,agent_id,endpoint_url,verification_url,token_hash,created_at,expires_at,completed_at,event_source) VALUES(?,?,?,?,?,?,?,NULL,?)`).bind(challenge.id,agentId,endpoint.url,challenge.verificationUrl,await hash(token),stamp,expires,cleanSource(source)).run();
    return challenge;
  }
  async getVerificationChallenge(agentId,challengeId){const r=await this.db.prepare('SELECT * FROM agent_verification_challenges WHERE id=? AND agent_id=?').bind(challengeId,agentId).first();return r?{id:r.id,agentId:r.agent_id,endpointUrl:r.endpoint_url,verificationUrl:r.verification_url,tokenHash:r.token_hash,createdAt:r.created_at,expiresAt:r.expires_at,completedAt:r.completed_at}:null;}
  async completeVerificationChallenge(agentId,challengeId,{source='direct'}={}){
    const c=await this.getVerificationChallenge(agentId,challengeId);if(!c)throw problem('verification_challenge_not_found',404);if(c.completedAt)return this.getAgent(agentId);if(Date.parse(c.expiresAt)<Date.now())throw problem('verification_challenge_expired',410);
    const stamp=new Date().toISOString();
    const result=await this.db.batch([
      this.db.prepare('UPDATE agents SET verified=1,verified_at=?,updated_at=?,event_source=? WHERE id=? AND verified=0').bind(stamp,stamp,cleanSource(source),agentId),
      this.db.prepare('UPDATE agent_verification_challenges SET completed_at=? WHERE id=? AND completed_at IS NULL').bind(stamp,challengeId)
    ]);
    if(changes(result[1])!==1)throw problem('verification_challenge_state_changed',409);
    const op=await this.db.prepare('SELECT operator_id FROM operator_agents WHERE agent_id=?').bind(agentId).first();if(op?.operator_id)await this.recomputeOperatorTrust(op.operator_id);
    return this.getAgent(agentId);
  }

  async claimIdempotency(scope,key,requestHash){
    if(!key)return{owner:true,keyHash:null};const keyHash=await hash(key),stamp=new Date().toISOString(),expires=new Date(Date.now()+24*60*60*1000).toISOString();
    await this.db.prepare('DELETE FROM idempotency_records WHERE expires_at < ?').bind(stamp).run();
    const r=await this.db.prepare(`INSERT OR IGNORE INTO idempotency_records(scope,idempotency_key_hash,request_hash,state,created_at,expires_at) VALUES(?,?,?,'pending',?,?)`).bind(scope,keyHash,requestHash,stamp,expires).run();
    if(changes(r)===1)return{owner:true,keyHash};const existing=await this.db.prepare('SELECT * FROM idempotency_records WHERE scope=? AND idempotency_key_hash=?').bind(scope,keyHash).first();
    if(!existing)return this.claimIdempotency(scope,key,requestHash);if(existing.request_hash!==requestHash)throw problem('idempotency_key_reused_with_different_request',409);if(existing.state==='complete')return{owner:false,replay:{status:n(existing.response_status),payload:p(existing.response_body_json,{})}};throw problem('idempotency_request_in_progress',409);
  }
  async finishIdempotency(scope,keyHash,response){if(!keyHash)return;await this.db.prepare(`UPDATE idempotency_records SET state='complete',response_status=?,response_body_json=? WHERE scope=? AND idempotency_key_hash=? AND state='pending'`).bind(response.status,j(response.payload),scope,keyHash).run();}
  async releaseIdempotency(scope,keyHash){if(keyHash)await this.db.prepare(`DELETE FROM idempotency_records WHERE scope=? AND idempotency_key_hash=? AND state='pending'`).bind(scope,keyHash).run();}


  async getPayment(id){const r=await this.db.prepare('SELECT * FROM payments WHERE id=?').bind(id).first();return r?paymentRow(r):null;}
  async getTaskPayment(taskId){const r=await this.db.prepare("SELECT * FROM payments WHERE task_id=? AND status NOT IN('failed','cancelled') ORDER BY created_at DESC LIMIT 1").bind(taskId).first();return r?paymentRow(r):null;}
  async createPayment(taskId,requesterAgentId,input={},ctx={}){
    const t=await this.mustTask(taskId);if(t.requesterAgentId&&t.requesterAgentId!==requesterAgentId)throw problem('requester_mismatch',403);if(t.status!=='accepted')throw problem('task_must_be_accepted_before_payment',409);
    await this.assertEconomicActionAllowed(t.requesterAgentId,'payment_create');await this.assertEconomicActionAllowed(t.providerAgentId,'payment_create');
    const risk=await this.db.prepare('SELECT trust_eligible FROM tasks WHERE id=?').bind(taskId).first();if(risk&&n(risk.trust_eligible)!==1)throw problem('task_under_trust_review',409);
    const money=normalizePayment(input),stamp=new Date().toISOString(),id=uid('pay'),provider=String(ctx.provider||'disabled');
    if(!['mock','stripe','disabled'].includes(provider))throw problem('invalid_payment_provider',400);
    try{await this.db.prepare(`INSERT INTO payments(id,task_id,requester_agent_id,provider_agent_id,provider,provider_reference,amount_minor,platform_fee_bps,platform_fee_minor,payer_total_minor,currency,status,event_source,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'created',?,?,?)`).bind(id,taskId,t.requesterAgentId||requesterAgentId,t.providerAgentId,provider,null,money.amountMinor,money.platformFeeBps,money.platformFeeMinor,money.payerTotalMinor,money.currency,cleanSource(ctx.source),stamp,stamp).run();}
    catch(e){if(isUnique(e))throw problem('active_payment_exists',409);throw e;}return this.getPayment(id);
  }
  async transitionPayment(paymentId,to,actorAgentId,input={},ctx={}){
    const pmt=await this.getPayment(paymentId);if(!pmt)throw problem('payment_not_found',404);if(pmt.status===to)return pmt;if(!paymentTransitionAllowed(pmt.status,to))throw problem(`invalid_payment_transition_${pmt.status}_to_${to}`,409);
    if(!ctx.system&&['funded','cancelled','refunded','released'].includes(to)&&pmt.requesterAgentId&&pmt.requesterAgentId!==actorAgentId)throw problem('payment_requester_mismatch',403);
    if(to==='released'){const task=await this.mustTask(pmt.taskId);if(task.status!=='completed')throw problem('task_must_be_completed_before_release',409);if(!ctx.system){await this.assertEconomicActionAllowed(pmt.requesterAgentId,'payment_release');await this.assertEconomicActionAllowed(pmt.providerAgentId,'payment_release');const risk=await this.db.prepare('SELECT trust_eligible FROM tasks WHERE id=?').bind(pmt.taskId).first();if(risk&&n(risk.trust_eligible)!==1)throw problem('task_under_trust_review',409);}}
    const stamp=new Date().toISOString(),column={funded:'funded_at',held:'held_at',released:'released_at',refunded:'refunded_at',failed:'failed_at',cancelled:'cancelled_at'}[to];
    const r=await this.db.prepare(`UPDATE payments SET status=?,provider_reference=COALESCE(provider_reference,?),transfer_reference=COALESCE(?,transfer_reference),refund_reference=COALESCE(?,refund_reference),${column}=?,updated_at=?,event_source=? WHERE id=? AND status=?`)
      .bind(to,text(input.providerReference,200)||null,text(input.transferReference,200)||null,text(input.refundReference,200)||null,stamp,stamp,cleanSource(ctx.source),paymentId,pmt.status).run();
    if(changes(r)!==1)throw problem('payment_state_changed_retry',409);return this.getPayment(paymentId);
  }
  async claimProviderWebhook(provider,eventId,eventType){
    try{await this.db.prepare('INSERT INTO provider_webhook_events(provider,event_id,event_type,received_at) VALUES(?,?,?,?)').bind(text(provider,40),text(eventId,200),text(eventType,200),new Date().toISOString()).run();return true;}
    catch(e){if(isUnique(e))return false;throw e;}
  }
  async releaseProviderWebhook(provider,eventId){await this.db.prepare('DELETE FROM provider_webhook_events WHERE provider=? AND event_id=?').bind(text(provider,40),text(eventId,200)).run();}
  async attachPaymentProviderReference(paymentId,reference){const r=await this.db.prepare('UPDATE payments SET provider_reference=?,updated_at=? WHERE id=?').bind(text(reference,200),new Date().toISOString(),paymentId).run();if(changes(r)!==1)throw problem('payment_not_found',404);return this.getPayment(paymentId);}
  async getPaymentByProviderReference(reference){const r=await this.db.prepare('SELECT * FROM payments WHERE provider_reference=?').bind(reference).first();return r?paymentRow(r):null;}
  async getPayoutAccount(agentId){const r=await this.db.prepare("SELECT * FROM agent_payout_accounts WHERE agent_id=? AND provider='stripe'").bind(agentId).first();return r?payoutRow(r):null;}
  async getPayoutAccountByExternalId(externalId){const r=await this.db.prepare("SELECT * FROM agent_payout_accounts WHERE external_account_id=? AND provider='stripe'").bind(externalId).first();return r?payoutRow(r):null;}
  async savePayoutAccount(agentId,account){
    const stamp=new Date().toISOString(),existing=await this.getPayoutAccount(agentId),id=existing?.id||uid('payout');
    await this.db.prepare(`INSERT INTO agent_payout_accounts(id,agent_id,provider,external_account_id,country,charges_enabled,payouts_enabled,details_submitted,created_at,updated_at)
      VALUES(?,?,'stripe',?,?,?,?,?,?,?) ON CONFLICT(agent_id,provider) DO UPDATE SET external_account_id=excluded.external_account_id,country=excluded.country,charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,details_submitted=excluded.details_submitted,updated_at=excluded.updated_at`)
      .bind(id,agentId,account.id,account.country||null,account.charges_enabled?1:0,account.payouts_enabled?1:0,account.details_submitted?1:0,existing?.createdAt||stamp,stamp).run();
    return this.getPayoutAccount(agentId);
  }
  async updatePayoutAccountFromStripe(account){const existing=await this.getPayoutAccountByExternalId(account.id);if(!existing)return null;const payout=await this.savePayoutAccount(existing.agentId,account);await this.syncPaymentProviderVerification(existing.agentId,payout,{source:'stripe-webhook'});return payout;}

  async syncPaymentProviderVerification(agentId,payout,ctx={}){
    const trust=await this.getAgentTrust(agentId);if(!trust.operator)return null;
    const stamp=new Date().toISOString(),verified=Boolean(payout?.detailsSubmitted&&payout?.payoutsEnabled),expires=verified?new Date(Date.now()+90*86400000).toISOString():null;
    await this.db.batch([
      this.db.prepare(`INSERT INTO verification_checks(id,operator_id,check_type,provider,provider_reference_hash,status,evidence_json,checked_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(uid('vcheck'),trust.operator.id,'payment_provider','stripe',await hash(payout?.externalAccountId||''),verified?'verified':'pending',j({chargesEnabled:Boolean(payout?.chargesEnabled),payoutsEnabled:Boolean(payout?.payoutsEnabled),detailsSubmitted:Boolean(payout?.detailsSubmitted)}),stamp,expires),
      this.db.prepare(`UPDATE operators SET identity_verified_at=?,identity_verification_expires_at=?,updated_at=? WHERE id=?`)
        .bind(verified?stamp:null,verified?expires:null,stamp,trust.operator.id),
      this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(uid('audit'),'system','stripe','operator.payment_provider_check','operator',trust.operator.id,j({verified,source:cleanSource(ctx.source||'stripe')}),stamp)
    ]);
    await this.recomputeOperatorTrust(trust.operator.id);
    return this.getAgentTrust(agentId);
  }

  async applyAustralianBusinessVerification(agentId,lookup,ctx={}){
    const trust=await this.getAgentTrust(agentId);if(!trust.operator)throw problem('operator_required',409);
    if(trust.operator.country!=='AU')throw problem('australian_operator_required',409);
    const type=String(lookup.identifierType||'').toUpperCase();if(!['ABN','ACN'].includes(type))throw problem('business_identifier_type_invalid',400);
    const identifier=String(lookup.identifier||'').replace(/\D/g,'');
    const verified=Boolean(lookup.active&&lookup.registryName),stamp=new Date().toISOString(),expires=verified?new Date(Date.now()+30*86400000).toISOString():null;
    const identifierHash=await hash(`${type}:${identifier}`),referenceHash=await hash(`${lookup.provider||'abr'}:${type}:${identifier}`);
    const evidence={registryName:text(lookup.registryName,240)||null,registryStatus:text(lookup.status,80)||null,effectiveFrom:text(lookup.effectiveFrom,40)||null,state:text(lookup.state,20)||null,postcode:text(lookup.postcode,12)||null};
    await this.db.batch([
      this.db.prepare(`INSERT INTO verification_checks(id,operator_id,check_type,provider,provider_reference_hash,status,evidence_json,checked_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(uid('vcheck'),trust.operator.id,'business',text(lookup.provider,80)||'abr_abn_lookup',referenceHash,verified?'verified':'failed',j(evidence),stamp,expires),
      this.db.prepare(`UPDATE operators SET legal_name=CASE WHEN ? THEN ? ELSE legal_name END,business_identifier_type=?,business_identifier_last4=?,business_identifier_hash=?,business_verified_at=?,business_verification_expires_at=?,updated_at=? WHERE id=?`)
        .bind(verified?1:0,text(lookup.registryName,240)||null,type,identifier.slice(-4)||null,identifierHash,verified?stamp:null,verified?expires:null,stamp,trust.operator.id),
      this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(uid('audit'),'agent',agentId,'operator.business_registry_check','operator',trust.operator.id,j({verified,type,last4:identifier.slice(-4),source:cleanSource(ctx.source)}),stamp)
    ]);
    await this.recomputeOperatorTrust(trust.operator.id);
    return this.getAgentTrust(agentId);
  }

  async recomputeOperatorTrust(operatorId){
    const op=await this.db.prepare('SELECT * FROM operators WHERE id=?').bind(operatorId).first();if(!op)return null;
    const now=Date.now(),businessCurrent=Boolean(op.business_verified_at&&(!op.business_verification_expires_at||Date.parse(op.business_verification_expires_at)>now)),identityCurrent=Boolean(op.identity_verified_at&&(!op.identity_verification_expires_at||Date.parse(op.identity_verification_expires_at)>now));
    const payment=await this.db.prepare(`SELECT status,expires_at FROM verification_checks WHERE operator_id=? AND check_type='payment_provider' ORDER BY checked_at DESC LIMIT 1`).bind(operatorId).first();
    const paymentCurrent=Boolean(payment?.status==='verified'&&(!payment.expires_at||Date.parse(payment.expires_at)>now));
    const endpoint=await this.db.prepare(`SELECT COUNT(*) c FROM agents a JOIN operator_agents oa ON oa.agent_id=a.id WHERE oa.operator_id=? AND a.verified=1`).bind(operatorId).first();
    const endpointCurrent=n(endpoint?.c)>0,sanctionsClear=op.sanctions_status==='clear',riskOkay=!['hold','review','blocked'].includes(op.risk_level);
    const qualified=(op.kind==='business'?businessCurrent:identityCurrent)&&identityCurrent&&paymentCurrent&&endpointCurrent&&sanctionsClear&&riskOkay;
    const expires=qualified?[op.business_verification_expires_at,op.identity_verification_expires_at,payment?.expires_at].filter(Boolean).sort()[0]||null:null,stamp=new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`UPDATE operators SET operator_verified_at=CASE WHEN ? THEN COALESCE(operator_verified_at,?) ELSE NULL END,operator_verification_expires_at=?,updated_at=? WHERE id=?`).bind(qualified?1:0,stamp,expires,stamp,operatorId),
      this.db.prepare(`UPDATE agents SET trust_status=?,updated_at=? WHERE operator_id=?`).bind(qualified?'verified':'basic',stamp,operatorId)
    ]);
    return{qualified,businessCurrent,identityCurrent,paymentCurrent,endpointCurrent,sanctionsClear,riskOkay,expiresAt:expires};
  }

  async trustSummary(){
    const now=new Date().toISOString();
    const row=await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM operators) operators,
      (SELECT COUNT(*) FROM operators WHERE operator_verified_at IS NOT NULL AND (operator_verification_expires_at IS NULL OR operator_verification_expires_at>?)) verified_operators,
      (SELECT COUNT(*) FROM operators WHERE business_verified_at IS NOT NULL AND (business_verification_expires_at IS NULL OR business_verification_expires_at>?)) current_business_registry_checks,
      (SELECT COUNT(*) FROM agents WHERE verified=1) endpoint_verified_agents,
      (SELECT COUNT(*) FROM trust_cases WHERE status IN('open','investigating','appealed')) open_trust_cases,
      (SELECT COUNT(*) FROM risk_signals WHERE status='open' AND severity>=60) high_risk_signals`).bind(now,now).first();
    return{operators:n(row?.operators),verifiedOperators:n(row?.verified_operators),currentBusinessRegistryChecks:n(row?.current_business_registry_checks),endpointVerifiedAgents:n(row?.endpoint_verified_agents),openTrustCases:n(row?.open_trust_cases),highRiskSignals:n(row?.high_risk_signals),policyVersion:'au-v1'};
  }

  async getProtectionCaseByTask(taskId){
    const r=await this.db.prepare('SELECT * FROM payment_protection_cases WHERE task_id=?').bind(taskId).first();if(!r)return null;const evidence=await this.db.prepare('SELECT * FROM payment_protection_evidence WHERE case_id=? ORDER BY created_at ASC').bind(r.id).all();return protectionRow(r,evidence.results||[]);
  }
  async getProtectionCase(caseId){const r=await this.db.prepare('SELECT * FROM payment_protection_cases WHERE id=?').bind(caseId).first();if(!r)return null;const evidence=await this.db.prepare('SELECT * FROM payment_protection_evidence WHERE case_id=? ORDER BY created_at ASC').bind(caseId).all();return protectionRow(r,evidence.results||[]);}
  async addProtectionEvidence(caseId,actorAgentId,input={}){
    const c=await this.getProtectionCase(caseId);if(!c)throw problem('protection_case_not_found',404);const task=await this.mustTask(c.taskId);if(![task.requesterAgentId,task.providerAgentId].includes(actorAgentId))throw problem('actor_not_authorized',403);if(!['open','evidence','review'].includes(c.status))throw problem('protection_case_closed',409);
    const type=['note','artifact_reference','message_reference','external_reference'].includes(input.evidenceType)?input.evidenceType:'note',content=input.content??input.note??input.reference;if(content==null||String(content).trim()==='')throw problem('evidence_content_required',400);const stamp=new Date().toISOString();
    await this.db.batch([this.db.prepare(`INSERT INTO payment_protection_evidence(id,case_id,actor_agent_id,evidence_type,content_json,created_at) VALUES(?,?,?,?,?,?)`).bind(uid('pevd'),caseId,actorAgentId,type,j({value:typeof content==='string'?text(content,4000):content}),stamp),this.db.prepare(`UPDATE payment_protection_cases SET status=CASE WHEN status='open' THEN 'evidence' ELSE status END,updated_at=? WHERE id=?`).bind(stamp,caseId)]);return this.getProtectionCase(caseId);
  }
  async hasOpenProtectionCaseForPayment(paymentId){const r=await this.db.prepare(`SELECT id FROM payment_protection_cases WHERE payment_id=? AND status IN('open','evidence','review') LIMIT 1`).bind(paymentId).first();return Boolean(r);}
  async resolveProtectionCase(caseId,decision,note,ctx={}){
    if(!['release','refund'].includes(decision))throw problem('protection_resolution_invalid',400);const c=await this.getProtectionCase(caseId);if(!c)throw problem('protection_case_not_found',404);if(!['open','evidence','review'].includes(c.status))throw problem('protection_case_already_resolved',409);const stamp=new Date().toISOString(),taskStatus=decision==='release'?'completed':'cancelled',caseStatus=decision==='release'?'resolved_release':'resolved_refund';
    await this.db.batch([this.db.prepare(`UPDATE tasks SET status=?,completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,?) ELSE completed_at END,updated_at=?,event_source=? WHERE id=? AND status='disputed'`).bind(taskStatus,taskStatus,stamp,stamp,cleanSource(ctx.source||'trust-admin'),c.taskId),this.db.prepare(`UPDATE payment_protection_cases SET status=?,resolution_note=?,resolved_at=?,updated_at=? WHERE id=? AND status IN('open','evidence','review')`).bind(caseStatus,text(note,2000)||null,stamp,stamp,caseId),this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('audit'),'admin',text(ctx.actorId,120)||'trust-admin','payment_protection.resolved','payment_protection_case',caseId,j({decision,source:cleanSource(ctx.source)}),stamp)]);return this.getProtectionCase(caseId);
  }

  async paymentStats(){
    const out=await this.db.prepare(`SELECT currency,COUNT(*) payments,
      SUM(CASE WHEN status IN('funded','held','released','refunded') THEN amount_minor ELSE 0 END) gmv_minor,
      SUM(CASE WHEN status='released' THEN platform_fee_minor ELSE 0 END) platform_revenue_minor,
      SUM(CASE WHEN status='released' THEN amount_minor ELSE 0 END) provider_payout_minor,
      SUM(CASE WHEN status='refunded' THEN amount_minor+platform_fee_minor ELSE 0 END) refunded_minor,
      SUM(CASE WHEN status='refunded' THEN amount_minor ELSE 0 END) refunded_provider_minor,
      SUM(CASE WHEN status='released' THEN 1 ELSE 0 END) released,
      SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END) refunded
      FROM payments GROUP BY currency ORDER BY currency`).all();
    const byCurrency={};for(const r of out.results||[]){const gmv=n(r.gmv_minor),refundedProvider=n(r.refunded_provider_minor);byCurrency[r.currency]={payments:n(r.payments),gmvMinor:gmv,netGmvMinor:gmv-refundedProvider,platformRevenueMinor:n(r.platform_revenue_minor),providerPayoutMinor:n(r.provider_payout_minor),refundedMinor:n(r.refunded_minor),released:n(r.released),refunded:n(r.refunded)};}
    return{platformFeeBps:PLATFORM_FEE_BPS,platformFeePercent:PLATFORM_FEE_BPS/100,byCurrency};
  }

  async getAgentTrust(agentId){
    const agent=await this.getAgent(agentId);if(!agent)throw problem('agent_not_found',404);
    const op=await this.db.prepare(`SELECT o.* FROM operators o JOIN operator_agents oa ON oa.operator_id=o.id WHERE oa.agent_id=?`).bind(agentId).first();
    const checks=op?await this.db.prepare(`SELECT check_type,provider,status,checked_at,expires_at FROM verification_checks WHERE operator_id=? ORDER BY checked_at DESC LIMIT 50`).bind(op.id).all():{results:[]};
    const now=Date.now(),mapped=(checks.results||[]).map(r=>({type:r.check_type,provider:r.provider,status:r.status,checkedAt:r.checked_at,expiresAt:r.expires_at||null,current:r.status==='verified'&&(!r.expires_at||Date.parse(r.expires_at)>now)}));
    const businessCurrent=Boolean(mapped.find(x=>x.type==='business')?.current),paymentCurrent=Boolean(mapped.find(x=>x.type==='payment_provider')?.current),identityCurrent=Boolean(op?.identity_verified_at&&(!op.identity_verification_expires_at||Date.parse(op.identity_verification_expires_at)>now));
    const badges=[];if(agent.verified)badges.push('endpoint_control');if(businessCurrent)badges.push('au_business_registry');if(identityCurrent)badges.push('identity_provider');if(paymentCurrent)badges.push('payment_ready');if(agent.trustStatus==='verified')badges.push('verified_operator');
    return{agentId,trustStatus:agent.trustStatus||'unverified',badges,operator:op?operatorPublic(op):null,verificationChecks:mapped};
  }

  async createOperatorForAgent(agentId,input={},ctx={}){
    if(!await this.getAgent(agentId))throw problem('agent_not_found',404);
    const existing=await this.db.prepare('SELECT operator_id FROM operator_agents WHERE agent_id=?').bind(agentId).first();if(existing)return this.getAgentTrust(agentId);
    const stamp=new Date().toISOString(),operatorId=uid('op'),kind=input.kind==='individual'?'individual':'business',country=text(input.country||'AU',2).toUpperCase();
    const idType=['ABN','ACN','OTHER'].includes(input.businessIdentifierType)?input.businessIdentifierType:null,last4=input.businessIdentifier?text(input.businessIdentifier,40).replace(/\s/g,'').slice(-4):null;
    await this.db.batch([
      this.db.prepare(`INSERT INTO operators(id,kind,country,legal_name,business_identifier_type,business_identifier_last4,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(operatorId,kind,country,text(input.legalName,200)||null,idType,last4,stamp,stamp),
      this.db.prepare('INSERT INTO operator_agents(operator_id,agent_id,linked_at) VALUES(?,?,?)').bind(operatorId,agentId,stamp),
      this.db.prepare("UPDATE agents SET operator_id=?,trust_status='basic',updated_at=? WHERE id=?").bind(operatorId,stamp,agentId),
      this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('audit'),'agent',agentId,'operator.created','operator',operatorId,j({source:cleanSource(ctx.source)}),stamp)
    ]);
    return this.getAgentTrust(agentId);
  }

  async setOperatorSanctionsStatus(operatorId,status,ctx={}){
    const allowed=['not_screened','clear','review','blocked'];if(!allowed.includes(status))throw problem('sanctions_status_invalid',400);
    const stamp=new Date().toISOString(),r=await this.db.prepare('UPDATE operators SET sanctions_status=?,updated_at=? WHERE id=?').bind(status,stamp,operatorId).run();
    if(changes(r)!==1)throw problem('operator_not_found',404);
    await this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('audit'),'admin',text(ctx.actorId,120)||'trust-admin','operator.sanctions_review','operator',operatorId,j({status,source:cleanSource(ctx.source)}),stamp).run();
    await this.recomputeOperatorTrust(operatorId);
    const updated=await this.db.prepare('SELECT * FROM operators WHERE id=?').bind(operatorId).first();return{id:updated.id,sanctionsStatus:updated.sanctions_status,riskLevel:updated.risk_level,updatedAt:updated.updated_at};
  }

  async reportTrustCase(input={},ctx={}){
    const reason=text(input.reason,2000);if(!reason)throw problem('reason_required',400);const stamp=new Date().toISOString(),caseId=uid('case');
    await this.db.prepare(`INSERT INTO trust_cases(id,case_type,operator_id,agent_id,task_id,status,reason,evidence_json,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?,?)`)
      .bind(caseId,['fraud','scam','review_manipulation','identity','payment','other'].includes(input.caseType)?input.caseType:'other',input.operatorId||null,input.agentId||null,input.taskId||null,reason,j(input.evidence||{}),stamp,stamp).run();
    return{id:caseId,status:'open',createdAt:stamp};
  }

  async sameOperator(agentA,agentB){if(!agentA||!agentB)return false;const r=await this.db.prepare(`SELECT 1 linked FROM operator_agents a JOIN operator_agents b ON a.operator_id=b.operator_id WHERE a.agent_id=? AND b.agent_id=? LIMIT 1`).bind(agentA,agentB).first();return Boolean(r);}

  async assertEconomicActionAllowed(agentId,action='economic_action'){
    if(!agentId)return true;const op=await this.db.prepare(`SELECT o.id,o.risk_level,o.sanctions_status FROM operators o JOIN operator_agents oa ON oa.operator_id=o.id WHERE oa.agent_id=? LIMIT 1`).bind(agentId).first();if(!op)return true;
    if(['review','blocked'].includes(op.sanctions_status))throw problem(`operator_sanctions_${op.sanctions_status}`,409);
    if(['hold','review','blocked'].includes(op.risk_level))throw problem(`operator_risk_${op.risk_level}`,409);return true;
  }

  async setOperatorRiskState(operatorId,level,score=0,reason='',ctx={}){
    const allowed=['normal','monitor','hold','review','blocked'];if(!allowed.includes(level))throw problem('operator_risk_level_invalid',400);const safeScore=Math.max(0,Math.min(100,Math.round(Number(score)||0))),stamp=new Date().toISOString();
    const r=await this.db.prepare('UPDATE operators SET risk_level=?,risk_score=?,updated_at=? WHERE id=?').bind(level,safeScore,stamp,operatorId).run();if(changes(r)!==1)throw problem('operator_not_found',404);
    await this.db.batch([
      this.db.prepare(`INSERT INTO moderation_actions(id,operator_id,action_type,reason,starts_at,created_at) VALUES(?,?,?,?,?,?)`).bind(uid('mod'),operatorId,level==='normal'?'restore':level==='monitor'?'warn':level==='hold'||level==='review'?'payment_hold':'suspend',text(reason,2000)||`risk state ${level}`,stamp,stamp),
      this.db.prepare(`INSERT INTO security_audit_log(id,actor_type,actor_id,action,target_type,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('audit'),'admin',text(ctx.actorId,120)||'trust-admin','operator.risk_state','operator',operatorId,j({level,score:safeScore,reason:text(reason,500),source:cleanSource(ctx.source)}),stamp)
    ]);await this.recomputeOperatorTrust(operatorId);return{id:operatorId,riskLevel:level,riskScore:safeScore,updatedAt:stamp};
  }

  async evaluateTaskRisk(taskId,ctx={}){
    const t=await this.mustTask(taskId),signals=[],stamp=new Date().toISOString();if(!t.providerAgentId)return{taskId,score:0,level:'normal',signals:[]};
    if(await this.sameOperator(t.requesterAgentId,t.providerAgentId))signals.push({type:'related_operator_transaction',severity:100});
    const pair=await this.db.prepare(`SELECT COUNT(*) c FROM tasks WHERE requester_agent_id=? AND provider_agent_id=? AND status IN('completed','delivered','working','accepted')`).bind(t.requesterAgentId,t.providerAgentId).first();
    if(n(pair?.c)>=5)signals.push({type:'repeated_pair_activity',severity:35});
    const reverse=await this.db.prepare(`SELECT COUNT(*) c FROM tasks WHERE requester_agent_id=? AND provider_agent_id=? AND status='completed'`).bind(t.providerAgentId,t.requesterAgentId).first();
    if(n(reverse?.c)>=2)signals.push({type:'reciprocal_transaction_loop',severity:60});
    const providerOp=await this.db.prepare('SELECT operator_id FROM operator_agents WHERE agent_id=?').bind(t.providerAgentId).first();
    if(signals.length){const stmts=signals.map(x=>this.db.prepare(`INSERT INTO risk_signals(id,operator_id,agent_id,task_id,signal_type,severity,status,evidence_json,created_at) VALUES(?,?,?,?,?,?,'open',?,?)`).bind(uid('risk'),providerOp?.operator_id||null,t.providerAgentId,taskId,x.type,x.severity,j({source:cleanSource(ctx.source)}),stamp));await this.db.batch(stmts);}
    const score=Math.min(100,signals.reduce((m,x)=>Math.max(m,x.severity),0)),level=score>=80?'blocked':score>=60?'review':score>=40?'hold':score>=20?'monitor':'normal',trustEligible=score<60;
    await this.db.prepare('UPDATE tasks SET risk_score=?,risk_level=?,trust_eligible=?,updated_at=? WHERE id=?').bind(score,level,trustEligible?1:0,stamp,taskId).run();
    if(providerOp?.operator_id&&score>=40){const current=await this.db.prepare('SELECT risk_score FROM operators WHERE id=?').bind(providerOp.operator_id).first();if(score>n(current?.risk_score))await this.setOperatorRiskState(providerOp.operator_id,level,score,`automated task risk: ${signals.map(x=>x.type).join(',')}`,{source:ctx.source,actorId:'risk-engine'});}
    return{taskId,score,level,trustEligible,signals};
  }

  async mustTask(id){const t=await this.getTask(id);if(!t)throw problem('task_not_found',404);return t;}
}

function counterStmt(db,day,metric,source){return db.prepare(`INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(?,?,?,1) ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1`).bind(day,metric,source);}
function kpiRatio(numerator,denominator){return denominator>0?Math.round((numerator/denominator)*10000)/10000:null;}
function kpiMedian(rows,startKey,endKey){const values=rows.map(row=>{const start=Date.parse(row[startKey]||''),end=Date.parse(row[endKey]||'');return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/60000:null;}).filter(value=>value!=null).sort((a,b)=>a-b);if(!values.length)return null;const mid=Math.floor(values.length/2),value=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;return Math.round(value*100)/100;}
function agentRow(r){return{id:r.id,name:r.name,description:r.description,capabilities:p(r.capabilities_json,[]),protocols:p(r.protocols_json,[]),endpoints:p(r.endpoints_json,[]),pricing:p(r.pricing_json,{mode:'free'}),availability:Boolean(r.availability),verified:Boolean(r.verified),verifiedAt:r.verified_at||null,trustStatus:r.trust_status||'unverified',operatorId:r.operator_id||null,createdAt:r.created_at,updatedAt:r.updated_at,reputation:{rating:r.rating==null?null:Number(Number(r.rating).toFixed(2)),reviews:n(r.review_count),completedTasks:n(r.completed_tasks),disputedTasks:n(r.disputed_tasks)}};}
function taskRow(r){return{id:r.id,title:r.title,description:r.description,acceptanceCriteria:p(r.acceptance_criteria_json,[]),requesterAgentId:r.requester_agent_id||null,selectedProviderAgentId:r.selected_provider_agent_id||null,providerAgentId:r.provider_agent_id||null,requiredCapabilities:p(r.required_capabilities_json,[]),preferredProtocols:p(r.preferred_protocols_json,[]),budget:r.budget==null?null:Number(r.budget),currency:r.currency,status:r.status,artifact:p(r.artifact_json,null),artifactDigest:r.artifact_digest||null,deliveryNote:r.delivery_note||null,disputeReason:r.dispute_reason||null,revisionCount:n(r.revision_count),lastRevisionNote:r.last_revision_note||null,createdAt:r.created_at,updatedAt:r.updated_at,selectedAt:r.selected_at||null,acceptedAt:r.accepted_at||null,startedAt:r.started_at||null,deliveredAt:r.delivered_at||null,revisionRequestedAt:r.revision_requested_at||null,completedAt:r.completed_at||null};}
function messageRow(r){return{id:r.id,taskId:r.task_id,fromAgentId:r.from_agent_id||null,toAgentId:r.to_agent_id||null,type:r.type,body:r.body,createdAt:r.created_at};}
function eventRow(r){return{id:r.id,type:r.event_type,detail:{source:r.source,...p(r.detail_json,{})},at:r.created_at};}
function paymentRow(r){return{id:r.id,taskId:r.task_id,requesterAgentId:r.requester_agent_id||null,providerAgentId:r.provider_agent_id||null,provider:r.provider,providerReference:r.provider_reference||null,transferReference:r.transfer_reference||null,refundReference:r.refund_reference||null,amountMinor:n(r.amount_minor),platformFeeBps:n(r.platform_fee_bps),platformFeeMinor:n(r.platform_fee_minor),payerTotalMinor:n(r.payer_total_minor),currency:r.currency,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,fundedAt:r.funded_at||null,heldAt:r.held_at||null,releasedAt:r.released_at||null,refundedAt:r.refunded_at||null,failedAt:r.failed_at||null,cancelledAt:r.cancelled_at||null};}
function operatorPublic(r){const now=Date.now();return{id:r.id,kind:r.kind,country:r.country,legalName:r.legal_name||null,businessIdentifierType:r.business_identifier_type||null,businessIdentifierLast4:r.business_identifier_last4||null,identityVerified:Boolean(r.identity_verified_at),identityVerificationExpiresAt:r.identity_verification_expires_at||null,identityVerificationCurrent:Boolean(r.identity_verified_at&&(!r.identity_verification_expires_at||Date.parse(r.identity_verification_expires_at)>now)),businessVerified:Boolean(r.business_verified_at),businessVerificationExpiresAt:r.business_verification_expires_at||null,businessVerificationCurrent:Boolean(r.business_verified_at&&(!r.business_verification_expires_at||Date.parse(r.business_verification_expires_at)>now)),operatorVerified:Boolean(r.operator_verified_at&&(!r.operator_verification_expires_at||Date.parse(r.operator_verification_expires_at)>now)),operatorVerifiedAt:r.operator_verified_at||null,operatorVerificationExpiresAt:r.operator_verification_expires_at||null,verificationPolicyVersion:r.verification_policy_version||'au-v1',createdAt:r.created_at,updatedAt:r.updated_at};}
function payoutRow(r){return{id:r.id,agentId:r.agent_id,provider:r.provider,externalAccountId:r.external_account_id,country:r.country||null,chargesEnabled:Boolean(r.charges_enabled),payoutsEnabled:Boolean(r.payouts_enabled),detailsSubmitted:Boolean(r.details_submitted),createdAt:r.created_at,updatedAt:r.updated_at};}
function protectionRow(r,evidence=[]){return{id:r.id,taskId:r.task_id,paymentId:r.payment_id||null,openedByAgentId:r.opened_by_agent_id||null,status:r.status,reason:r.reason,snapshot:p(r.snapshot_json,{}),resolutionNote:r.resolution_note||null,createdAt:r.created_at,updatedAt:r.updated_at,resolvedAt:r.resolved_at||null,evidence:evidence.map(x=>({id:x.id,actorAgentId:x.actor_agent_id||null,type:x.evidence_type,content:p(x.content_json,{}),createdAt:x.created_at}))};}
function p(v,fallback){try{return v==null?fallback:JSON.parse(v)}catch{return fallback}}function j(v){return JSON.stringify(v)}function n(v){return Number(v||0)}function changes(r){return Number(r?.meta?.changes??r?.changes??0)}
function text(v,max){return String(v??'').trim().slice(0,max)}function cleanSource(v){return String(v||'direct').toLowerCase().replace(/[^a-z0-9_.:-]/g,'').slice(0,80)||'direct'}function clampRating(v){return Math.max(1,Math.min(5,Math.round(Number(v)||0)))}
function uid(prefix){return `${prefix}_${crypto.randomUUID()}`}function randomHex(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return[...a].map(x=>x.toString(16).padStart(2,'0')).join('')}function randomB64(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
async function hash(v){const data=new TextEncoder().encode(String(v));const digest=await crypto.subtle.digest('SHA-256',data);return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function isUnique(e){return /unique|constraint/i.test(String(e?.message||e))}function problem(code,status){return Object.assign(new Error(code.replaceAll('_',' ')),{code,status})}
