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
  assert.deepEqual(await h.json(), { ok: true, db: true, passwordSet: true, passwordSource: 'secret', passwordMinLength: 6, writeTokenSet: true });
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

test('편집 암호가 아무 데도 없으면 쓰기를 모두 막는다', async () => {
  assert.equal(await canWrite(req('/api/doc', { headers: { Authorization: 'Bearer ' } }), {}), false);
  assert.equal(await canWrite(req('/api/doc', { headers: { Authorization: 'Bearer x' } }), { DB: fakeD1() }), false);
});

test('대시보드 비밀값이 없으면 사이트에서 처음 한 번 암호를 정하고, 그 암호로만 저장된다', async () => {
  const e = env({ token: '' });
  const h0 = await (await worker.fetch(req('/api/health'), e)).json();
  assert.deepEqual([h0.passwordSet, h0.passwordSource], [false, null]);
  assert.equal((await put(e, { doc: { a: 1 }, version: 0 }, 'my-pass-1')).status, 401); // 정하기 전에는 저장 불가
  const claim = pw => worker.fetch(req('/api/password', { method: 'POST', body: JSON.stringify({ password: pw }) }), e);
  assert.equal((await claim('short')).status, 422);
  assert.equal((await claim('my-pass-1')).status, 201);
  assert.equal((await claim('other-pass')).status, 409);                                // 두 번째는 거절
  assert.ok(!e.DB.raw.prepare("SELECT value FROM settings WHERE key = 'write_hash'").get().value.includes('my-pass-1')); // 원문 저장 안 함
  assert.equal((await put(e, { doc: { a: 1 }, version: 0 }, 'other-pass')).status, 401);
  assert.equal((await put(e, { doc: { a: 1 }, version: 0 }, 'my-pass-1')).status, 200);
  const h1 = await (await worker.fetch(req('/api/health'), e)).json();
  assert.deepEqual([h1.passwordSet, h1.passwordSource], [true, 'site']);
});

test('대시보드 비밀값이 있으면 그것이 우선이고 사이트에서 정하기는 거절', async () => {
  const e = env();
  assert.equal((await worker.fetch(req('/api/password', { method: 'POST', body: JSON.stringify({ password: 'my-pass-1' }) }), e)).status, 409);
});

test('허용하지 않는 요청 방식은 405', async () => {
  const e = env();
  assert.equal((await worker.fetch(req('/api/doc', { method: 'DELETE' }), e)).status, 405);
  assert.equal((await worker.fetch(req('/api/trades/apply'), e)).status, 405);
});

test('문서 크기는 바이트로 잰다(한글은 글자당 3바이트)', async () => {
  const e = env();
  const big = '가'.repeat(90 * 1024); // 글자 수는 한도(256K)보다 작지만 바이트는 넘는다
  assert.equal((await put(e, { doc: { big }, version: 0 }, 'secret')).status, 413);
});

test('서버 오류는 안내 문구만 보여 주고 내부 내용은 감춘다', async () => {
  const e = { WRITE_TOKEN: 'secret', DB: { prepare: () => { throw new Error('비밀 내부 정보'); } }, ASSETS: { fetch: async () => new Response('') } };
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a);
  try {
    const r = await worker.fetch(req('/api/doc'), e);
    assert.equal(r.status, 500);
    assert.doesNotMatch(await r.text(), /비밀 내부 정보/);
    assert.ok(errs.length > 0);
  } finally { console.error = orig; }
});

test('체결은 한 번에 100건까지만 반영한다', async () => {
  const e = env();
  await put(e, { doc: { assets: [] }, version: 0 }, 'secret');
  const trades = Array.from({ length: 101 }, () => ({ ticker: 'X', side: 'buy', qty: 1, price: 1 }));
  const r = await worker.fetch(req('/api/trades/apply', { method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, kind: 'manual', trades }) }), e);
  assert.equal(r.status, 422);
  assert.match((await r.json()).detail, /100건/);
});
