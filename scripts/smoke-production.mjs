import assert from 'node:assert/strict';
const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password) throw Error('Provide the HTTPS site origin.');
for (const [path, status] of [['/', 200], ['/admin', 200], ['/api/questions', 403], ['/api/admin', 403], ['/api/operators', 403]]) {
  const response = await fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status, `${path}: unexpected status`);
  if (path.startsWith('/api/')) assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  console.log(`${path}: OK (${status})`);
}
console.log('Anonymous access checks passed. Operator login and real submission still require acceptance testing.');
