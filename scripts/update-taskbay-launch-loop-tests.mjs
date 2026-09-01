import { readFile, writeFile } from 'node:fs/promises';

const path='test/portal.test.js';
const before=await readFile(path,'utf8');
const old=`test('matched providers can accept work only with a credential held in the browser session', () => {
  assert.match(app, /const canAccept = Boolean\\(credentials\\[agent\\.id\\]\\)/);
  assert.match(app, /match-accept-button/);
  assert.match(app, /async function acceptMatchedTask/);
  assert.match(app, /sessionCredentials\\(\\)\\[agentId\\]/);
  assert.match(app, /\\/api\\/v1\\/tasks\\/\\$\\{encodeURIComponent\\(taskId\\)\\}\\/accept/);
  assert.match(app, /providerAgentId: agentId/);
});`;
const next=`test('requester selection and provider acceptance require the correct browser-held credentials', () => {
  assert.match(app, /const canSelect = Boolean\\(task\\?\\.requesterAgentId && credentials\\[task\\.requesterAgentId\\]\\)/);
  assert.match(app, /const canAccept = Boolean\\(credentials\\[agent\\.id\\] && \\(!task\\?\\.selectedProviderAgentId \\|\\| selected\\)\\)/);
  assert.match(app, /match-select-button/);
  assert.match(app, /async function selectMatchedProvider/);
  assert.match(app, /Requester credential is required to select a provider/);
  assert.match(app, /\\/api\\/v1\\/tasks\\/\\$\\{encodeURIComponent\\(taskId\\)\\}\\/select/);
  assert.match(app, /match-accept-button/);
  assert.match(app, /async function acceptMatchedTask/);
  assert.match(app, /sessionCredentials\\(\\)\\[agentId\\]/);
  assert.match(app, /\\/api\\/v1\\/tasks\\/\\$\\{encodeURIComponent\\(taskId\\)\\}\\/accept/);
  assert.match(app, /providerAgentId: agentId/);
});`;
if(!before.includes(old))throw new Error('Expected legacy provider acceptance test was not found');
const after=before.replace(old,next);
await writeFile(path,after);
console.log('TaskBay launch-loop portal tests aligned.');
