import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgent,normalizeTask,scoreMatch,transitionAllowed,sha256 } from '../src/domain.js';

test('match score rewards capability and protocol overlap',()=>{
  const a={...normalizeAgent({capabilities:['research','summarization'],protocols:['mcp']}),reputation:{rating:5}};
  const t=normalizeTask({requiredCapabilities:['research','summarization'],preferredProtocols:['mcp']});
  assert.equal(scoreMatch(a,t),100);
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
  const a={...normalizeAgent({capabilities:['api code review','security audit'],protocols:['mcp']}),reputation:{rating:4.5}};
  const t=normalizeTask({requiredCapabilities:['api-review','security_audit'],preferredProtocols:['mcp']});
  assert.ok(scoreMatch(a,t)>=90);
});

test('matching does not treat a weak one-word coincidence as a qualified capability',()=>{
  const a={...normalizeAgent({capabilities:['financial research'],protocols:['mcp']}),reputation:{rating:5}};
  const t=normalizeTask({requiredCapabilities:['legal research'],preferredProtocols:['mcp']});
  assert.equal(scoreMatch(a,t),0);
});

test('task lifecycle only allows defined transitions',()=>{
  assert.equal(transitionAllowed('open','accepted'),true);
  assert.equal(transitionAllowed('open','completed'),false);
  assert.equal(transitionAllowed('delivered','completed'),true);
});

test('published endpoints require https',()=>{
  const a=normalizeAgent({endpoints:[{protocol:'mcp',url:'http://example.com/mcp'},{protocol:'a2a',url:'https://example.com/a2a'}]});
  assert.equal(a.endpoints.length,1);
  assert.equal(a.endpoints[0].protocol,'a2a');
});

test('artifact digest is deterministic',async()=>{
  assert.equal(await sha256({a:1}),await sha256({a:1}));
});
