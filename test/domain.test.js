import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgent,normalizeTask,matchBreakdown,scoreMatch,transitionAllowed,sha256 } from '../src/domain.js';

test('match score rewards capability, protocol and verified evidence',()=>{
  const a={...normalizeAgent({capabilities:['research','summarization'],protocols:['mcp']}),verified:true,trustStatus:'verified',reputation:{rating:5,completedTasks:8,disputedTasks:0}};
  const t=normalizeTask({requiredCapabilities:['research','summarization'],preferredProtocols:['mcp']});
  assert.equal(scoreMatch(a,t),100);
});

test('matching exposes an explainable score breakdown',()=>{
  const a={...normalizeAgent({capabilities:['api review'],protocols:['mcp']}),verified:true,reputation:{rating:4.5,completedTasks:3,disputedTasks:1}};
  const t=normalizeTask({requiredCapabilities:['api-review'],preferredProtocols:['mcp']});
  const breakdown=matchBreakdown(a,t);
  assert.ok(breakdown.score>0);
  assert.equal(breakdown.capability,1);
  assert.equal(breakdown.protocol,1);
  assert.ok(breakdown.reputation>0&&breakdown.reputation<=1);
  assert.equal(breakdown.reason,'qualified');
});

test('matching excludes agents with zero required capability overlap',()=>{
  const a={...normalizeAgent({capabilities:['translation'],protocols:['mcp']}),reputation:{rating:5}};
  const t=normalizeTask({requiredCapabilities:['research','summarization'],preferredProtocols:['mcp']});
  assert.equal(scoreMatch(a,t),0);
});

test('matching still allows useful partial capability overlap',()=>{
  const a={...normalizeAgent({capabilities:['research'],protocols:['mcp']}),reputation:{rating:5}};
  const t=normalizeTask({requiredCapabilities:['research','summarization'],preferredProtocols:['mcp']});
  assert.ok(scoreMatch(a,t)>0);
});

test('matching tolerates common capability separators and compound labels',()=>{
  const a={...normalizeAgent({capabilities:['api code review','security audit'],protocols:['mcp']}),verified:true,reputation:{rating:4.5,completedTasks:2,disputedTasks:0}};
  const t=normalizeTask({requiredCapabilities:['api-review','security_audit'],preferredProtocols:['mcp']});
  assert.ok(scoreMatch(a,t)>=85);
});

test('matching does not treat a weak one-word coincidence as a qualified capability',()=>{
  const a={...normalizeAgent({capabilities:['financial research'],protocols:['mcp']}),reputation:{rating:5}};
  const t=normalizeTask({requiredCapabilities:['legal research'],preferredProtocols:['mcp']});
  assert.equal(scoreMatch(a,t),0);
});

test('task normalization preserves explicit acceptance criteria without flattening them into description',()=>{
  const task=normalizeTask({
    title:'Review migration',
    description:'Inspect the release candidate.',
    acceptanceCriteria:['No P0 findings','Return a concise report','Include artifact references']
  });
  assert.deepEqual(task.acceptanceCriteria,['No P0 findings','Return a concise report','Include artifact references']);
  assert.equal(task.revisionCount,0);
  assert.equal(task.selectedProviderAgentId,null);
});

test('task lifecycle supports requester revision after delivery but not arbitrary rewinds',()=>{
  assert.equal(transitionAllowed('open','accepted'),true);
  assert.equal(transitionAllowed('open','completed'),false);
  assert.equal(transitionAllowed('delivered','completed'),true);
  assert.equal(transitionAllowed('delivered','working'),true);
  assert.equal(transitionAllowed('completed','working'),false);
});

test('published endpoints require https',()=>{
  const a=normalizeAgent({endpoints:[{protocol:'mcp',url:'http://example.com/mcp'},{protocol:'a2a',url:'https://example.com/a2a'}]});
  assert.equal(a.endpoints.length,1);
  assert.equal(a.endpoints[0].protocol,'a2a');
});

test('artifact digest is deterministic',async()=>{
  assert.equal(await sha256({a:1}),await sha256({a:1}));
});
