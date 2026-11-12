// Worker 라우팅과 편집 암호 검사(가짜 D1·정적 자산으로 확인). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { canWrite } from '../src/lib/http.js';

function fakeEnv({ token = 'secret', row = null, changes = 1 } = {}) {
  const log = [];
  const stmt = sql => ({
    bind: (...args) => ({ first: async () => row, run: async () => { log.push([sql, args]); return { meta: { changes } }; } }),
    first: async () => (sql.includes('SELECT 1') ? { one: 1 } : row),
  });
  return { log, env: { WRITE_TOKEN: token, DB: { prepare: stmt }, ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } } };
}
const req = (path, init) => new Request('https://x.test' + path, init);

test('정적 파일은 ASSETS로, /api/health는 D1 확인', async () => {
  const { env } = fakeEnv();
  assert.equal(await (await worker.fetch(req('/'), env)).text(), 'asset');
  const h = await worker.fetch(req('/api/health'), env);
  assert.deepEqual(await h.json(), { ok: true, db: true, writeTokenSet: true });
});

test('편집 암호: 없거나 틀리면 401, 맞으면 저장', async () => {
  const { env, log } = fakeEnv({ row: { body: '{"a":1}', version: 3 } });
  const put = auth => worker.fetch(req('/api/doc', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify({ doc: { a: 2 }, version: 3 }) }), env);
  assert.equal((await put()).status, 401);
  assert.equal((await put('wrong')).status, 401);
  const ok = await put('secret');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { version: 4 });
  assert.match(log[0][0], /UPDATE doc/);
});

test('다른 기기에서 먼저 저장했으면 409와 최신 문서', async () => {
  const { env } = fakeEnv({ row: { body: '{"a":9}', version: 5 }, changes: 0 });
  const r = await worker.fetch(req('/api/doc', { method: 'PUT', headers: { Authorization: 'Bearer secret' }, body: JSON.stringify({ doc: { a: 2 }, version: 4 }) }), env);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { doc: { a: 9 }, version: 5 });
});

test('WRITE_TOKEN이 설정되지 않았으면 쓰기를 모두 막는다', () => {
  const r = req('/api/doc', { headers: { Authorization: 'Bearer ' } });
  assert.equal(canWrite(r, {}), false);
});

test('허용하지 않는 요청 방식은 405', async () => {
  const { env } = fakeEnv();
  assert.equal((await worker.fetch(req('/api/doc', { method: 'DELETE' }), env)).status, 405);
});
