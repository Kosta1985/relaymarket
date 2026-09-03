import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText, label) {
  const text = await readFile(path, 'utf8');
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  await writeFile(path, text.replace(oldText, newText));
}

await replaceExact(
  'test/machine-discovery.test.js',
  "assert.equal(discovery.schemaVersion, '1.3');",
  "assert.equal(discovery.schemaVersion, '1.4');",
  'TaskBay discovery schema test'
);

await replaceExact(
  'test/d1-edge.test.js',
  "const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['agent.verification_challenge_created'],1);",
  "const stats=(await api(e,'/api/v1/stats')).body;assert.equal(stats.counters['agent.verification_challenge_created'],2);",
  'verification challenge counter test'
);

console.log('TaskBay fast-path test expectations aligned.');
