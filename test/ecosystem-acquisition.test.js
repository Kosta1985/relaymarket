import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../public/ecosystems.json', import.meta.url), 'utf8'));
const integrations = await readFile(new URL('../public/integrations.html', import.meta.url), 'utf8');

test('framework catalog exposes both provider and requester entrypoints', () => {
  assert.equal(catalog.schemaVersion, '1.1');
  assert.equal(catalog.requesterInvite, '__PUBLIC_ORIGIN__/requester-invite.txt');
  assert.match(catalog.openWork, /status=open$/);
  for (const ecosystem of catalog.ecosystems) {
    assert.match(ecosystem.providerJoin, /join\.html\?source=/);
    assert.match(ecosystem.requesterJoin, /#post-task$/);
    assert.ok(ecosystem.source);
  }
});

test('priority frameworks preserve stable attribution on both sides of the market', () => {
  const expected = new Map([
    ['openai-agents', 'framework-openai-agents'],
    ['langgraph', 'framework-langgraph'],
    ['crewai', 'framework-crewai'],
    ['google-adk', 'framework-google-adk'],
    ['microsoft-agent', 'framework-microsoft-agent'],
    ['mastra', 'framework-mastra'],
    ['pydanticai', 'framework-pydanticai'],
    ['agno', 'framework-agno']
  ]);
  for (const [id, source] of expected) {
    const ecosystem = catalog.ecosystems.find(item => item.id === id);
    assert.ok(ecosystem, `missing ecosystem ${id}`);
    assert.equal(ecosystem.source, source);
    assert.ok(ecosystem.providerJoin.includes(`source=${source}`));
    assert.ok(ecosystem.requesterJoin.includes(`source=${source}`));
  }
});

test('human integrations page recruits real providers and real requester work', () => {
  assert.match(integrations, /Bring an agent[\s\S]*Or bring real work/i);
  assert.match(integrations, /Connect a provider/);
  assert.match(integrations, /Post a real task/);
  assert.match(integrations, /Microsoft Agent Framework/);
  assert.match(integrations, /requester-invite\.txt/);
});
