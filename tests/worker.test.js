// Worker 라우팅과 편집 암호 검사(가짜 D1·정적 자산). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { canWrite } from '../src/lib/http.js';
import { fakeD1 } from './fake_d1.js';

function env({ token = 'secret' } = {}) {
  return { WRITE_TOKEN: token, DB: fakeD1(), ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
}
const req = (path, init) => new Request('https://x.test' + path, init);
const put = (e, body, auth) => worker.fetch(req('/api/doc', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }), e);

test('정적 파일은 ASSETS로, /api/health는 D1 확인', async () => {
  const e = env();
  assert.equal(await (await worker.fetch(req('/'), e)).text(), 'asset');
  const h = await worker.fetch(req('/api/health'), e);
  assert.deepEqual(await h.json(), { ok: true, db: true, writeTokenSet: true });
});

test('처음에는 빈 문서(version 0), 편집 암호가 없거나 틀리면 401, 맞으면 저장', async () => {
  const e = env();
  assert.deepEqual(await (await worker.fetch(req('/api/doc'), e)).json(), { doc: {}, version: 0 });
  assert.equal((await put(e, { doc: { a: 1 }, version: 0 })).status, 401);
  assert.equal((await put(e, { doc: { a: 1 }, version: 0 }, 'wrong')).status, 401);
  const ok = await put(e, { doc: { a: 1 }, version: 0 }, 'secret');
  assert.deepEqual(await ok.json(), { version: 1 });
  assert.deepEqual(await (await worker.fetch(req('/api/doc'), e)).json(), { doc: { a: 1 }, version: 1 });
});

test('다른 기기에서 먼저 저장했으면 409와 최신 문서', async () => {
  const e = env();
  await put(e, { doc: { a: 9 }, version: 0 }, 'secret');
  await put(e, { doc: { a: 10 }, version: 1 }, 'secret');
  const r = await put(e, { doc: { a: 2 }, version: 1 }, 'secret');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { doc: { a: 10 }, version: 2 });
});

test('가격·월말 기록은 누구나 읽는다(빈 상태)', async () => {
  const e = env();
  const p = await (await worker.fetch(req('/api/prices'), e)).json();
  assert.deepEqual(p, { asOf: null, fx: null, fxDate: null, quotes: {}, lastRun: null });
  assert.deepEqual(await (await worker.fetch(req('/api/snapshots'), e)).json(), { snapshots: [] });
});

test('WRITE_TOKEN이 설정되지 않았으면 쓰기를 모두 막는다', () => {
  assert.equal(canWrite(req('/api/doc', { headers: { Authorization: 'Bearer ' } }), {}), false);
});

test('허용하지 않는 요청 방식은 405', async () => {
  const e = env();
  assert.equal((await worker.fetch(req('/api/doc', { method: 'DELETE' }), e)).status, 405);
  assert.equal((await worker.fetch(req('/api/trades/apply'), e)).status, 405);
});
