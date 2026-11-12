// 체결 반영·되돌리기 API(가짜 D1). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { fakeD1 } from './fake_d1.js';

const DOC = {
  monthly: 1000000, carry: 0, band: 5,
  groups: [{ id: 'g', name: 'G', target: 100, mode: 'ratio' }],
  assets: [{ name: 'A', ticker: '360750', market: 'KR', qty: 10, avg: 20000, unit: 1, group: 'g' }],
};
async function setup(version = 3) {
  const DB = fakeD1();
  await DB.prepare("INSERT INTO doc (id, body, version, updated_at) VALUES (1, ?, ?, 'x')").bind(JSON.stringify(DOC), version).run();
  return { DB, WRITE_TOKEN: 'secret', ASSETS: { fetch: async () => new Response('asset') } };
}
const call = (env, path, body, token = 'secret', method = 'POST') => worker.fetch(new Request('https://x.test' + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env);
const BUY = [{ ticker: '360750', side: 'buy', qty: 40, price: 23000 }];

test('반영: 문서·버전이 바뀌고 체결 기록이 남는다', async () => {
  const env = await setup();
  const r = await call(env, '/api/trades/apply', { version: 3, kind: 'monthly', trades: BUY });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.version, 4);
  assert.equal(j.doc.assets[0].qty, 50);
  assert.equal(j.doc.assets[0].avg, 22400);   // (10×20,000 + 40×23,000) ÷ 50
  assert.equal(j.doc.carry, 80000);           // 1,000,000 − 920,000
  const doc = await (await call(env, '/api/doc', undefined, null, 'GET')).json();
  assert.equal(doc.version, 4);
  assert.equal(doc.doc.assets[0].qty, 50);
  const t = await (await call(env, '/api/trades', undefined, null, 'GET')).json();
  assert.equal(t.trades.length, 1);
  assert.deepEqual({ ...t.trades[0], id: 0, date: '' }, { id: 0, batch: j.batch, date: '', ticker: '360750', side: 'buy', qty: 40, price: 23000, currency: 'KRW', fx: null, kind: 'monthly' });
});

test('되돌리기: 직전 문서로 복구하고 체결 기록을 지운다. 두 번은 안 된다', async () => {
  const env = await setup();
  const j = await (await call(env, '/api/trades/apply', { version: 3, kind: 'monthly', trades: BUY })).json();
  const u = await call(env, '/api/trades/undo', { batch: j.batch });
  assert.equal(u.status, 200);
  const uj = await u.json();
  assert.equal(uj.version, 5);
  assert.deepEqual(uj.doc, DOC);
  const t = await (await call(env, '/api/trades', undefined, null, 'GET')).json();
  assert.equal(t.trades.length, 0);
  assert.equal((await call(env, '/api/trades/undo', { batch: j.batch })).status, 409);
});

test('반영 뒤 다른 수정이 있으면 되돌리지 않는다(409)', async () => {
  const env = await setup();
  const j = await (await call(env, '/api/trades/apply', { version: 3, kind: 'monthly', trades: BUY })).json();
  const put = await call(env, '/api/doc', { doc: { ...j.doc, monthly: 5 }, version: 4 }, 'secret', 'PUT');
  assert.equal(put.status, 200);
  const u = await call(env, '/api/trades/undo', { batch: j.batch });
  assert.equal(u.status, 409);
  assert.equal((await u.json()).doc.monthly, 5);
});

test('버전이 다르면 409와 최신 문서, 기록은 남지 않는다', async () => {
  const env = await setup();
  const r = await call(env, '/api/trades/apply', { version: 2, kind: 'monthly', trades: BUY });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { doc: DOC, version: 3 });
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trades').first();
  assert.equal(n.n, 0);
});

test('편집 암호가 없으면 401, 잘못된 입력은 422', async () => {
  const env = await setup();
  assert.equal((await call(env, '/api/trades/apply', { version: 3, trades: BUY }, null)).status, 401);
  assert.equal((await call(env, '/api/trades/undo', { batch: 1 }, 'wrong')).status, 401);
  assert.equal((await call(env, '/api/prices/refresh', {}, null)).status, 401);
  assert.equal((await call(env, '/api/trades/apply', { version: 3, trades: [{ ticker: '360750', side: 'buy', qty: 0, price: 1 }] })).status, 422);
  assert.equal((await call(env, '/api/trades/apply', { version: 3, trades: [{ ticker: 'QQQ', side: 'buy', qty: 1, price: 1 }] })).status, 422);
});

test('달러 체결은 저장된 최신 환율을 쓴다(화면이 환율을 보내지 않았을 때)', async () => {
  const env = await setup();
  const doc = { ...DOC, assets: [...DOC.assets, { name: 'Q', ticker: 'QQQ', market: 'US', qty: 0, avg: 0, unit: 1, group: 'g' }] };
  await env.DB.prepare('UPDATE doc SET body = ? WHERE id = 1').bind(JSON.stringify(doc)).run();
  await env.DB.prepare("INSERT INTO fx VALUES ('2026-11-11', 1400, 'yahoo')").run();
  const j = await (await call(env, '/api/trades/apply', { version: 3, kind: 'manual', trades: [{ ticker: 'QQQ', side: 'buy', qty: 1, price: 600 }] })).json();
  assert.equal(j.doc.carry, 160000); // 1,000,000 − 600 × 1,400
  assert.equal(j.doc.assets[1].avg, 600);
});
