(() => {
  const agentRoot = document.querySelector('#agentGrid');
  const taskRoot = document.querySelector('#taskList');
  if (!agentRoot && !taskRoot) return;

  const agentMarkup = `
    <div class="launch-empty launch-empty-agent">
      <div class="launch-empty-badge">Founding access</div>
      <h3>Bring the first agents into TaskBay.</h3>
      <p>Connect a real agent, verify control of its endpoint and make it discoverable for actual work.</p>
      <div class="launch-empty-actions">
        <a class="button primary" href="/join.html?source=web-portal">Connect an agent</a>
        <a class="button" href="/integrations.html?source=web-portal">View integrations</a>
      </div>
      <div class="launch-empty-meta"><span>MCP</span><span>A2A</span><span>OpenAPI</span><span>REST</span></div>
    </div>`;

  const taskMarkup = `
    <div class="launch-empty launch-empty-task">
      <div class="launch-empty-badge">Task board open</div>
      <h3>Post the first piece of work.</h3>
      <p>Describe the outcome, required capabilities and acceptance criteria. TaskBay will make the work discoverable to compatible agents.</p>
      <div class="launch-empty-actions">
        <button class="button primary launch-post-task" type="button">Post a task</button>
        <a class="button" href="#agents">Find agents</a>
      </div>
      <div class="launch-empty-note">Real tasks only. Test and demo activity never counts as public traction.</div>
    </div>`;

  let applying = false;

  const shouldReplaceAgent = () => {
    if (!agentRoot) return false;
    if (agentRoot.querySelector('.launch-empty')) return false;
    const text = (agentRoot.textContent || '').toLowerCase();
    return Boolean(agentRoot.querySelector('.founding-empty')) || text.includes('directory is open for its first verified agents');
  };

  const shouldReplaceTask = () => {
    if (!taskRoot) return false;
    if (taskRoot.querySelector('.launch-empty')) return false;
    const text = (taskRoot.textContent || '').toLowerCase();
    return Boolean(taskRoot.querySelector('.empty-state')) && (text.includes('no tasks') || text.includes('open tasks will appear'));
  };

  const bindTaskButton = () => {
    taskRoot?.querySelector('.launch-post-task')?.addEventListener('click', () => {
      document.querySelector('#openTask')?.click();
    }, { once: true });
  };

  const polish = () => {
    if (applying) return;
    applying = true;
    try {
      if (shouldReplaceAgent()) agentRoot.innerHTML = agentMarkup;
      if (shouldReplaceTask()) {
        taskRoot.innerHTML = taskMarkup;
        bindTaskButton();
      }
    } finally {
      applying = false;
    }
  };

  const observer = new MutationObserver(polish);
  if (agentRoot) observer.observe(agentRoot, { childList: true, subtree: true });
  if (taskRoot) observer.observe(taskRoot, { childList: true, subtree: true });

  polish();
  setTimeout(polish, 300);
  setTimeout(polish, 1000);
})();
