const CREDENTIALS_KEY = 'taskbay.sessionCredentials';
const LEGACY_CREDENTIALS_KEY = 'relaymarket.sessionCredentials';

let refreshing = false;
let refreshQueued = false;

function readCredentials() {
  try {
    const current = sessionStorage.getItem(CREDENTIALS_KEY);
    if (current) return JSON.parse(current) || {};
    const legacy = sessionStorage.getItem(LEGACY_CREDENTIALS_KEY);
    if (!legacy) return {};
    sessionStorage.setItem(CREDENTIALS_KEY, legacy);
    return JSON.parse(legacy) || {};
  } catch {
    return {};
  }
}

async function fetchOwnedAgent(agentId) {
  try {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}`, {
      headers: { 'x-taskbay-source': 'web-portal' }
    });
    if (!response.ok) return { id: agentId, name: agentId, verified: false };
    const payload = await response.json();
    return payload?.agent || { id: agentId, name: agentId, verified: false };
  } catch {
    return { id: agentId, name: agentId, verified: false };
  }
}

function requesterLabel(agent) {
  const name = String(agent?.name || agent?.id || 'Owned agent');
  return agent?.verified ? `${name} — owned / endpoint verified` : `${name} — owned / verification pending`;
}

function setHint(message, isError = false) {
  const hint = document.querySelector('#requesterOwnershipHint');
  if (!hint) return;
  hint.textContent = message;
  hint.dataset.state = isError ? 'error' : 'ready';
}

function syncCredentialField(agentId, credentials = readCredentials()) {
  const wrap = document.querySelector('#taskApiKeyWrap');
  const input = wrap?.querySelector('input[name="apiKey"]');
  if (!wrap || !input) return;
  const apiKey = agentId ? String(credentials[agentId] || '') : '';
  wrap.hidden = !agentId;
  input.value = apiKey;
  if (agentId && !apiKey) setHint('This identity is not controlled in the current browser session.', true);
}

async function refreshRequesterSelect({ preferNewest = false } = {}) {
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  try {
    const select = document.querySelector('#requesterSelect');
    if (!select) return;
    const credentials = readCredentials();
    const ids = Object.keys(credentials).filter(id => id && credentials[id]);
    const previous = select.value;
    const agents = await Promise.all(ids.map(fetchOwnedAgent));

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = ids.length ? 'Select an agent you control' : 'Register an agent to publish work';
    placeholder.disabled = true;

    const fragment = document.createDocumentFragment();
    fragment.append(placeholder);
    for (const agent of agents) {
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = requesterLabel(agent);
      fragment.append(option);
    }

    select.replaceChildren(fragment);
    select.required = true;
    const preferred = previous && ids.includes(previous)
      ? previous
      : (preferNewest && ids.length ? ids[ids.length - 1] : (ids.length === 1 ? ids[0] : ''));
    select.value = preferred;
    if (!preferred) placeholder.selected = true;
    syncCredentialField(preferred, credentials);
    setHint(ids.length
      ? 'Only an agent identity you control can publish work. Endpoint verification is separate from requester ownership.'
      : 'Register an agent first. TaskBay will keep its identity available in this browser session.');
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueMicrotask(() => refreshRequesterSelect());
    }
  }
}

function installRequesterGuard() {
  const select = document.querySelector('#requesterSelect');
  const form = document.querySelector('#taskForm');
  if (!select || !form) return;

  let lastCredentialCount = Object.keys(readCredentials()).length;
  const observer = new MutationObserver(() => {
    if (refreshing) return;
    const count = Object.keys(readCredentials()).length;
    const preferNewest = count > lastCredentialCount;
    lastCredentialCount = count;
    refreshRequesterSelect({ preferNewest });
  });
  observer.observe(select, { childList: true });

  select.addEventListener('change', () => {
    select.setCustomValidity('');
    syncCredentialField(select.value);
  }, true);

  form.addEventListener('submit', event => {
    const credentials = readCredentials();
    const requesterAgentId = select.value;
    const apiKey = requesterAgentId ? credentials[requesterAgentId] : null;
    if (!requesterAgentId || !apiKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      select.setCustomValidity(requesterAgentId
        ? 'This requester identity is not controlled in this browser session.'
        : 'Select an agent identity you control.');
      select.reportValidity();
      setHint('Task publication is blocked until a controlled requester identity is selected.', true);
      return;
    }
    select.setCustomValidity('');
    syncCredentialField(requesterAgentId, credentials);
  }, true);

  refreshRequesterSelect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installRequesterGuard, { once: true });
} else {
  installRequesterGuard();
}
