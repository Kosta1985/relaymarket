import { readFile, writeFile } from 'node:fs/promises';

const path='public/app.js';
const before=await readFile(path,'utf8');
const start=before.indexOf('function renderTasks(rows) {');
const end=before.indexOf('\n\nfunction renderEvents(rows) {',start);
if(start<0||end<0)throw new Error('Task rendering block was not found');
const replacement=`function renderTasks(rows) {
  const root = $('#taskList');
  if (!root) return;
  if (!rows.length) {
    root.innerHTML = emptyState('No tasks in this state.', 'Open tasks will appear here as agents publish work.');
    return;
  }
  const credentials=sessionCredentials();
  root.innerHTML = rows.map(task => {
    const requesterKey=Boolean(task.requesterAgentId&&credentials[task.requesterAgentId]);
    const providerKey=Boolean(task.providerAgentId&&credentials[task.providerAgentId]);
    const criteria=(task.acceptanceCriteria||[]).length?\`<div class="task-criteria"><strong>Acceptance criteria</strong><ul>\${task.acceptanceCriteria.map(item=>\`<li>\${esc(item)}</li>\`).join('')}</ul></div>\`:'';
    const revision=task.revisionCount?\`<div class="task-revision"><strong>Revision \${esc(task.revisionCount)}</strong>\${task.lastRevisionNote?\`<span>\${esc(task.lastRevisionNote)}</span>\`:''}</div>\`:'';
    const actions=[];
    if(task.status==='open')actions.push(\`<button class="button secondary match-button" data-task-id="\${escAttr(task.id)}" type="button">Find agents -></button>\`);
    if(task.status==='accepted'&&providerKey)actions.push(\`<button class="button primary task-action-button" data-action="start" data-task-id="\${escAttr(task.id)}" type="button">Start work</button>\`);
    if(task.status==='working'&&providerKey)actions.push(\`<button class="button primary task-action-button" data-action="deliver" data-task-id="\${escAttr(task.id)}" type="button">\${task.revisionCount?'Redeliver':'Deliver work'}</button>\`);
    if(task.status==='delivered'&&requesterKey){actions.push(\`<button class="button ghost task-action-button" data-action="revise" data-task-id="\${escAttr(task.id)}" type="button">Request revision</button>\`);actions.push(\`<button class="button primary task-action-button" data-action="complete" data-task-id="\${escAttr(task.id)}" type="button">Complete task</button>\`);}
    const providerLabel=task.providerAgentId?\`provider \${esc(shortId(task.providerAgentId))}\`:task.selectedProviderAgentId?\`selected \${esc(shortId(task.selectedProviderAgentId))}\`:'capability matching';
    return \`<article class="task-card">
      <div>
        <div class="task-topline"><span class="status-pill \${esc(task.status)}">\${esc(task.status)}</span><span class="task-time">\${esc(timeAgo(task.createdAt))}</span>\${task.budget != null ? \`<span class="task-time">\${esc(task.currency)} \${esc(task.budget)}</span>\` : ''}</div>
        <h3>\${esc(task.title)}</h3><p>\${esc(task.description || 'No description provided.')}</p>
        \${criteria}\${revision}
        <div class="tags">\${(task.requiredCapabilities || []).map(x => \`<span class="tag">\${esc(x)}</span>\`).join('')}\${(task.preferredProtocols || []).map(x => \`<span class="tag protocol">\${esc(x)}</span>\`).join('')}</div>
      </div>
      <div class="task-side"><span class="task-score-hint">\${providerLabel}</span><div class="task-actions">\${actions.join('')}</div></div>
    </article>\`;
  }).join('');
  root.querySelectorAll('.match-button').forEach(button => button.addEventListener('click', () => showMatches(button.dataset.taskId)));
  root.querySelectorAll('.task-action-button').forEach(button => button.addEventListener('click', () => runTaskAction(button.dataset.taskId,button.dataset.action,button)));
}

async function runTaskAction(taskId,action,button){
  const task=state.tasks.find(row=>row.id===taskId);if(!task)return showToast('Task is no longer available.',true);
  const credentials=sessionCredentials();
  const original=button?.textContent;if(button){button.disabled=true;button.textContent='Working...';}
  try{
    if(action==='start'){
      const apiKey=task.providerAgentId?credentials[task.providerAgentId]:null;if(!apiKey)throw new Error('Provider credential is required to start work.');
      await mutation(\`/api/v1/tasks/\${encodeURIComponent(taskId)}/start\`,{providerAgentId:task.providerAgentId},{apiKey});
      showToast('Task moved to working.');
    }else if(action==='deliver'){
      const apiKey=task.providerAgentId?credentials[task.providerAgentId]:null;if(!apiKey)throw new Error('Provider credential is required to deliver work.');
      const artifactText=window.prompt('Paste the result, artifact reference, URL, digest, or concise delivery payload.');if(artifactText===null)return;
      const note=window.prompt('Delivery note (optional):',task.revisionCount?'Revision completed.':'Work completed.')??'';
      await mutation(\`/api/v1/tasks/\${encodeURIComponent(taskId)}/deliver\`,{providerAgentId:task.providerAgentId,artifact:{text:artifactText},note},{apiKey});
      showToast(task.revisionCount?'Revision redelivered.':'Work delivered.');
    }else if(action==='revise'){
      const apiKey=task.requesterAgentId?credentials[task.requesterAgentId]:null;if(!apiKey)throw new Error('Requester credential is required to request a revision.');
      const reason=window.prompt('What needs to change before this work can be accepted?');if(!reason?.trim())return;
      await mutation(\`/api/v1/tasks/\${encodeURIComponent(taskId)}/revise\`,{requesterAgentId:task.requesterAgentId,reason:reason.trim()},{apiKey});
      showToast('Revision requested. The task is back in working state.');
    }else if(action==='complete'){
      const apiKey=task.requesterAgentId?credentials[task.requesterAgentId]:null;if(!apiKey)throw new Error('Requester credential is required to complete the task.');
      if(!window.confirm('Confirm that the delivered work meets the acceptance criteria and complete this task?'))return;
      const ratingRaw=window.prompt('Optional provider rating from 1 to 5:','5');const rating=ratingRaw==null||ratingRaw.trim()===''?null:Number(ratingRaw);if(rating!=null&&(!Number.isFinite(rating)||rating<1||rating>5))throw new Error('Rating must be between 1 and 5.');
      const comment=window.prompt('Optional completion note:','')??'';
      await mutation(\`/api/v1/tasks/\${encodeURIComponent(taskId)}/complete\`,{requesterAgentId:task.requesterAgentId,...(rating==null?{}:{rating}),comment},{apiKey});
      showToast('Task completed and marketplace evidence updated.');
    }
    await loadAll();
  }catch(error){showToast(error.message,true);}finally{if(button?.isConnected){button.disabled=false;button.textContent=original||button.textContent;}}
}`;
const after=before.slice(0,start)+replacement+before.slice(end);
if(after===before)throw new Error('Portal execution codemod produced no change');
await writeFile(path,after);
console.log('TaskBay portal execution controls applied.');
