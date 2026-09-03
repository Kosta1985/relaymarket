import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText, label) {
  const text = await readFile(path, 'utf8');
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  await writeFile(path, text.replace(oldText, newText));
}

await replaceExact('cloudflare/src/index.js', `          const registered = await repo.registerAgent(body, { source });
          return {
            status: 201,
            payload: {
              agent: registered.agent,
              credential: {
                apiKey: registered.credential.apiKey,
                credentialId: registered.credential.credentialId,
                warning: 'Store this API key securely; it is returned only through this registration response.'
              }
            }
          };`, `          const registered = await repo.registerAgent(body, { source });
          let verification = registered.agent?.endpoints?.length
            ? { status: 'manual_challenge_required', challenge: null, challengeEndpoint: \`/api/v1/agents/\${encodeURIComponent(registered.agent.id)}/verification-challenges\` }
            : { status: 'endpoint_required', challenge: null };
          if (registered.agent?.endpoints?.length) {
            try {
              const challenge = await repo.createVerificationChallenge(registered.agent.id, 0, { source });
              verification = { status: 'challenge_created', challenge, nextAction: 'publish_token_then_verify' };
            } catch (error) {
              verification = {
                status: 'manual_challenge_required',
                challenge: null,
                error: error?.code || 'verification_challenge_creation_failed',
                challengeEndpoint: \`/api/v1/agents/\${encodeURIComponent(registered.agent.id)}/verification-challenges\`
              };
            }
          }
          return {
            status: 201,
            payload: {
              agent: registered.agent,
              credential: {
                apiKey: registered.credential.apiKey,
                credentialId: registered.credential.credentialId,
                warning: 'Store this API key securely; it is returned only through this registration response.'
              },
              verification
            }
          };`, 'cloudflare registration');

await replaceExact('src/server.js', "if(req.method==='POST'&&url.pathname==='/api/v1/agents')return await mutation(req,res,url,source,async b=>{const agent=await createAgent(b,{source}),credential=await issueCredential(agent.id,{source});return{status:201,payload:{agent,credential:{apiKey:credential.apiKey,credentialId:credential.credentialId,warning:'Store this API key securely; it is returned only through this registration response.'}}}});", "if(req.method==='POST'&&url.pathname==='/api/v1/agents')return await mutation(req,res,url,source,async b=>{const agent=await createAgent(b,{source}),credential=await issueCredential(agent.id,{source});let verification=agent.endpoints?.length?{status:'manual_challenge_required',challenge:null,challengeEndpoint:`/api/v1/agents/${encodeURIComponent(agent.id)}/verification-challenges`}:{status:'endpoint_required',challenge:null};if(agent.endpoints?.length){try{verification={status:'challenge_created',challenge:await createVerificationChallenge(agent.id,0,source),nextAction:'publish_token_then_verify'}}catch(error){verification={status:'manual_challenge_required',challenge:null,error:error?.code||'verification_challenge_creation_failed',challengeEndpoint:`/api/v1/agents/${encodeURIComponent(agent.id)}/verification-challenges`}}}return{status:201,payload:{agent,credential:{apiKey:credential.apiKey,credentialId:credential.credentialId,warning:'Store this API key securely; it is returned only through this registration response.'},verification}}});", 'local registration');

await replaceExact('src/discovery.js', "'201': { description: 'Agent registered; API key is returned exactly once in this response' }", "'201': { description: 'Agent registered; API key is returned exactly once. When a public endpoint is supplied, TaskBay also attempts to return an endpoint verification challenge in the same response.' }", 'OpenAPI registration response');

{
  const path = 'scripts/connect-agent.mjs';
  const text = await readFile(path, 'utf8');
  const startNeedle = 'const challengeResponse = await fetch(`${origin}/api/v1/agents/${encodeURIComponent(agentId)}/verification-challenges`, {';
  const endNeedle = "const challenge = challengePayload?.challenge || {};\n";
  const start = text.indexOf(startNeedle);
  const end = text.indexOf(endNeedle, start);
  if (start < 0 || end < 0) throw new Error('connect-agent challenge block not found');
  const replacement = `let challenge = registerPayload?.verification?.challenge || null;
if (!challenge?.id || !challenge?.token || !challenge?.verificationUrl) {
  const challengeResponse = await fetch(\`${'${origin}'}/api/v1/agents/${'${encodeURIComponent(agentId)}'}/verification-challenges\`, {
    method: 'POST',
    headers: {
      authorization: \`Bearer ${'${apiKey}'}\`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      'x-taskbay-source': source
    },
    body: JSON.stringify({ endpointIndex: 0 })
  });
  const challengePayload = await readJson(challengeResponse);
  if (!challengeResponse.ok) {
    console.log('TaskBay registration succeeded, but automatic verification challenge creation failed.');
    console.log(\`Agent ID: ${'${agentId}'}\`);
    console.log('API KEY — STORE THIS SECURELY. IT IS RETURNED ONLY ONCE:');
    console.log(apiKey);
    failResponse('Challenge creation failed', challengeResponse, challengePayload);
  }
  challenge = challengePayload?.challenge || null;
}
`;
  await writeFile(path, text.slice(0, start) + replacement + text.slice(end + endNeedle.length));
}

await writeFile('test/verification-fastpath.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../cloudflare/src/index.js', import.meta.url), 'utf8');
const local = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const connect = await readFile(new URL('../scripts/connect-agent.mjs', import.meta.url), 'utf8');
const discovery = await readFile(new URL('../src/discovery.js', import.meta.url), 'utf8');

test('registration attempts endpoint verification challenge without hiding the one-time credential', () => {
  assert.match(edge, /status: 'challenge_created'/);
  assert.match(edge, /manual_challenge_required/);
  assert.match(edge, /apiKey: registered\\.credential\\.apiKey/);
  assert.match(local, /status:'challenge_created'/);
  assert.match(local, /manual_challenge_required/);
});

test('connect helper consumes same-response challenge and keeps old-runtime fallback', () => {
  assert.match(connect, /registerPayload\\?\\.verification\\?\\.challenge/);
  assert.match(connect, /verification-challenges/);
  assert.match(connect, /x-taskbay-source/);
});

test('OpenAPI documents same-response verification challenge', () => {
  assert.match(discovery, /also attempts to return an endpoint verification challenge in the same response/);
});
`);

console.log('TaskBay verification fast-path patch prepared.');
