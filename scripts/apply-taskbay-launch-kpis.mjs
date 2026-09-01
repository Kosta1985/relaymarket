import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}
function once(source, from, to, label) {
  const at=source.indexOf(from);if(at<0)throw new Error(`Missing expected fragment: ${label}`);
  if(source.indexOf(from,at+from.length)>=0)throw new Error(`Ambiguous fragment: ${label}`);
  return source.slice(0,at)+to+source.slice(at+from.length);
}

await edit('cloudflare/src/repository.js', source => {
  source=once(source,
`  async metrics(){
    const out=await this.db.prepare('SELECT day,metric,source,count FROM marketplace_daily_counters ORDER BY day DESC,metric,source LIMIT 5000').all(),totals={},bySource={},daily={};`,
`  async launchKpis(){
    const summary=await this.db.prepare(\`SELECT
      (SELECT COUNT(*) FROM agents WHERE verified=1) endpoint_verified_agents,
      (SELECT COUNT(DISTINCT operator_id) FROM agents WHERE verified=1 AND operator_id IS NOT NULL) independent_verified_operators,
      (SELECT COUNT(*) FROM tasks WHERE status='open') open_tasks,
      (SELECT COUNT(*) FROM tasks WHERE selected_provider_agent_id IS NOT NULL) selected_tasks,
      (SELECT COUNT(*) FROM tasks WHERE selected_provider_agent_id IS NOT NULL AND accepted_at IS NOT NULL) selected_accepted_tasks,
      (SELECT COUNT(*) FROM tasks WHERE accepted_at IS NOT NULL) accepted_tasks,
      (SELECT COUNT(*) FROM tasks WHERE delivered_at IS NOT NULL) delivered_tasks,
      (SELECT COUNT(*) FROM tasks WHERE completed_at IS NOT NULL) completed_tasks,
      (SELECT COUNT(*) FROM (SELECT requester_agent_id FROM tasks WHERE completed_at IS NOT NULL AND trust_eligible=1 AND requester_agent_id IS NOT NULL GROUP BY requester_agent_id HAVING COUNT(*)>1)) repeat_requesters,
      (SELECT COUNT(*) FROM (SELECT provider_agent_id FROM tasks WHERE completed_at IS NOT NULL AND trust_eligible=1 AND provider_agent_id IS NOT NULL GROUP BY provider_agent_id HAVING COUNT(*)>1)) repeat_providers\`).first();
    const timingRows=(await this.db.prepare(\`SELECT created_at,selected_at,accepted_at,delivered_at,completed_at FROM tasks WHERE selected_at IS NOT NULL OR accepted_at IS NOT NULL OR delivered_at IS NOT NULL OR completed_at IS NOT NULL ORDER BY created_at DESC LIMIT 5000\`).all()).results||[];
    const metrics=await this.metrics(),totals=metrics.totals||{},selected=n(summary?.selected_tasks),selectedAccepted=n(summary?.selected_accepted_tasks),accepted=n(summary?.accepted_tasks),delivered=n(summary?.delivered_tasks),completed=n(summary?.completed_tasks),disputes=n(totals['task.disputed']);
    const acquisitionSources=Object.entries(metrics.bySource||{}).map(([source,values])=>({source,agentRegistrations:n(values?.['agent.registered']),taskCreations:n(values?.['task.created']),matchRequests:n(values?.['match.requested']),providerSelections:n(values?.['task.provider_selected'])})).filter(row=>row.agentRegistrations||row.taskCreations||row.matchRequests||row.providerSelections).sort((a,b)=>(b.agentRegistrations+b.taskCreations+b.matchRequests+b.providerSelections)-(a.agentRegistrations+a.taskCreations+a.matchRequests+a.providerSelections));
    return{
      contractVersion:'launch-v1',
      endpointVerifiedAgents:n(summary?.endpoint_verified_agents),
      independentVerifiedOperators:n(summary?.independent_verified_operators),
      openTasks:n(summary?.open_tasks),
      providerSelections:selected,
      acceptedTasks:accepted,
      deliveredTasks:delivered,
      completedTasks:completed,
      repeatRequesters:n(summary?.repeat_requesters),
      repeatProviders:n(summary?.repeat_providers),
      matchRequests:n(totals['match.requested']),
      disputeEvents:disputes,
      conversion:{selectionToAccept:ratio(selectedAccepted,selected),acceptToDeliver:ratio(delivered,accepted),deliverToComplete:ratio(completed,delivered),deliveredToDispute:ratio(disputes,delivered)},
      medianMinutes:{createToSelection:medianDuration(timingRows,'created_at','selected_at'),selectionToAccept:medianDuration(timingRows,'selected_at','accepted_at'),acceptToDeliver:medianDuration(timingRows,'accepted_at','delivered_at'),createToCompletion:medianDuration(timingRows,'created_at','completed_at')},
      acquisitionSources,
      definitions:{independentVerifiedOperators:'Distinct linked operators represented by endpoint-verified agents. Agents without an operator link are not counted as independently verified operators.',matchRequests:'Requests to the ranking surface, not unique users and not guaranteed qualified matches.',disputeEvents:'Successful task.disputed lifecycle events. A later resolution does not erase the historical dispute event.',conversion:'Observed persisted task timestamps only; null when the denominator is zero.'}
    };
  }
  async metrics(){
    const out=await this.db.prepare('SELECT day,metric,source,count FROM marketplace_daily_counters ORDER BY day DESC,metric,source LIMIT 5000').all(),totals={},bySource={},daily={};`, 'D1 launch KPI method');
  source=once(source,
`function counterStmt(db,day,metric,source){return db.prepare(\`INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(?,?,?,1) ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1\`).bind(day,metric,source);}`,
`function counterStmt(db,day,metric,source){return db.prepare(\`INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(?,?,?,1) ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1\`).bind(day,metric,source);}
function ratio(numerator,denominator){return denominator>0?Math.round((numerator/denominator)*10000)/10000:null;}
function medianDuration(rows,startKey,endKey){const values=rows.map(row=>{const start=Date.parse(row[startKey]||''),end=Date.parse(row[endKey]||'');return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/60000:null;}).filter(value=>value!=null).sort((a,b)=>a-b);if(!values.length)return null;const mid=Math.floor(values.length/2),value=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;return Math.round(value*100)/100;}`, 'D1 KPI helpers');
  return source;
});

await edit('src/store.js', source => {
  source=once(source,
`export function metrics(){const totals={},bySource={},daily={};for(const [key,count] of Object.entries(state.metrics)){const [day,metric,...sourceParts]=key.split('|'),source=sourceParts.join('|');if(source==='all'){totals[metric]=(totals[metric]||0)+count;daily[day]??={};daily[day][metric]=(daily[day][metric]||0)+count;}else{bySource[source]??={};bySource[source][metric]=(bySource[source][metric]||0)+count;}}return{totals,bySource,daily};}`,
`export function launchKpis(){const tasks=[...state.tasks.values()],agents=[...state.agents.values()],metricData=metrics(),totals=metricData.totals||{},selected=tasks.filter(t=>t.selectedProviderAgentId).length,selectedAccepted=tasks.filter(t=>t.selectedProviderAgentId&&t.acceptedAt).length,accepted=tasks.filter(t=>t.acceptedAt).length,delivered=tasks.filter(t=>t.deliveredAt).length,completed=tasks.filter(t=>t.completedAt).length;const repeats=field=>new Set(Object.entries(tasks.filter(t=>t.completedAt&&t[field]).reduce((acc,t)=>(acc[t[field]]=(acc[t[field]]||0)+1,acc),{})).filter(([,count])=>count>1).map(([id])=>id)).size;const acquisitionSources=Object.entries(metricData.bySource||{}).map(([source,values])=>({source,agentRegistrations:Number(values?.['agent.registered']||0),taskCreations:Number(values?.['task.created']||0),matchRequests:Number(values?.['match.requested']||0),providerSelections:Number(values?.['task.provider_selected']||0)})).filter(row=>row.agentRegistrations||row.taskCreations||row.matchRequests||row.providerSelections);return{contractVersion:'launch-v1',endpointVerifiedAgents:agents.filter(a=>a.verified).length,independentVerifiedOperators:new Set(agents.filter(a=>a.verified&&a.operatorId).map(a=>a.operatorId)).size,openTasks:tasks.filter(t=>t.status==='open').length,providerSelections:selected,acceptedTasks:accepted,deliveredTasks:delivered,completedTasks:completed,repeatRequesters:repeats('requesterAgentId'),repeatProviders:repeats('providerAgentId'),matchRequests:Number(totals['match.requested']||0),disputeEvents:Number(totals['task.disputed']||0),conversion:{selectionToAccept:localRatio(selectedAccepted,selected),acceptToDeliver:localRatio(delivered,accepted),deliverToComplete:localRatio(completed,delivered),deliveredToDispute:localRatio(Number(totals['task.disputed']||0),delivered)},medianMinutes:{createToSelection:localMedian(tasks,'createdAt','selectedAt'),selectionToAccept:localMedian(tasks,'selectedAt','acceptedAt'),acceptToDeliver:localMedian(tasks,'acceptedAt','deliveredAt'),createToCompletion:localMedian(tasks,'createdAt','completedAt')},acquisitionSources,definitions:{independentVerifiedOperators:'Distinct linked operators represented by endpoint-verified agents. Agents without an operator link are not counted as independently verified operators.',matchRequests:'Requests to the ranking surface, not unique users and not guaranteed qualified matches.',disputeEvents:'Successful task.disputed lifecycle events. A later resolution does not erase the historical dispute event.',conversion:'Observed persisted task timestamps only; null when the denominator is zero.'}};}
export function metrics(){const totals={},bySource={},daily={};for(const [key,count] of Object.entries(state.metrics)){const [day,metric,...sourceParts]=key.split('|'),source=sourceParts.join('|');if(source==='all'){totals[metric]=(totals[metric]||0)+count;daily[day]??={};daily[day][metric]=(daily[day][metric]||0)+count;}else{bySource[source]??={};bySource[source][metric]=(bySource[source][metric]||0)+count;}}return{totals,bySource,daily};}`, 'local KPI method');
  source += `\nfunction localRatio(numerator,denominator){return denominator>0?Math.round((numerator/denominator)*10000)/10000:null;}\nfunction localMedian(rows,startKey,endKey){const values=rows.map(row=>{const start=Date.parse(row[startKey]||''),end=Date.parse(row[endKey]||'');return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/60000:null;}).filter(value=>value!=null).sort((a,b)=>a-b);if(!values.length)return null;const mid=Math.floor(values.length/2),value=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;return Math.round(value*100)/100;}\n`;
  return source;
});

await edit('cloudflare/src/index.js', source => once(source,
`    if (url.pathname === '/api/v1/stats' && request.method === 'GET') return json(await repo.stats());
    if (url.pathname === '/api/v1/metrics' && request.method === 'GET') return json(await repo.metrics());`,
`    if (url.pathname === '/api/v1/stats' && request.method === 'GET') return json(await repo.stats());
    if (url.pathname === '/api/v1/kpis' && request.method === 'GET') return json(await repo.launchKpis());
    if (url.pathname === '/api/v1/metrics' && request.method === 'GET') return json(await repo.metrics());`, 'edge KPI route'));

await edit('src/server.js', source => {
  source=once(source,'stats,metrics,recentEvents','stats,launchKpis,metrics,recentEvents','local KPI import');
  source=once(source,
`if(req.method==='GET'&&url.pathname==='/api/v1/stats')return send(res,200,stats());
    if(req.method==='GET'&&url.pathname==='/api/v1/metrics')return send(res,200,metrics());`,
`if(req.method==='GET'&&url.pathname==='/api/v1/stats')return send(res,200,stats());
    if(req.method==='GET'&&url.pathname==='/api/v1/kpis')return send(res,200,launchKpis());
    if(req.method==='GET'&&url.pathname==='/api/v1/metrics')return send(res,200,metrics());`, 'local KPI route');
  return source;
});

await edit('src/discovery.js', source => once(source,
`      '/api/v1/stats': { get: { summary: 'Get aggregate marketplace statistics', operationId: 'getStats', responses: { '200': { description: 'Evidence-based marketplace statistics' } } } },
      '/api/v1/metrics':`,
`      '/api/v1/stats': { get: { summary: 'Get aggregate marketplace statistics', operationId: 'getStats', responses: { '200': { description: 'Evidence-based marketplace statistics' } } } },
      '/api/v1/kpis': { get: { summary: 'Get evidence-based launch KPIs', operationId: 'getLaunchKpis', responses: { '200': { description: 'Observed marketplace conversions, median lifecycle times, repeat participation and acquisition-source measurements' } } } },
      '/api/v1/metrics':`, 'OpenAPI KPI route'));

console.log('TaskBay launch KPI codemod applied.');
