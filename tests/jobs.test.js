// 예약 작업(src/jobs.js): 매일 가격 수집, 그 달 마지막 날이면 월말 기록. 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { daily, runScheduled, supabaseKeepalive, isLastDayOfMonth } from '../src/jobs.js';
import { fakeD1 } from './fake_d1.js';

// 업비트만 응답하는 가짜 인터넷(나머지 출처는 막혀 있다고 가정)
const fakeNet = async url => {
  if (url.startsWith('https://api.upbit.com/')) return new Response(JSON.stringify([{ market: 'KRW-BTC', prev_closing_price: 150000000 }]));
  return new Response('blocked', { status: 403 });
};
async function seeded() {
  const DB = fakeD1();
  const doc = { monthly: 0, band: 5, groups: [{ id: 'c', name: '코인', target: 100, mode: 'ratio' }], assets: [{ name: '비트코인', ticker: 'KRW-BTC', market: 'CRYPTO', qty: 0.01, avg: 1, unit: 0.0001, group: 'c' }] };
  await DB.prepare("INSERT INTO doc (id, body, version, updated_at) VALUES (1, ?, 1, 'x')").bind(JSON.stringify(doc)).run();
  return DB;
}

test('그 달 마지막 날 판정(KST)', () => {
  assert.equal(isLastDayOfMonth(new Date('2026-11-29T22:30:00Z')), true);  // 11/30 07:30 KST
  assert.equal(isLastDayOfMonth(new Date('2026-11-30T22:30:00Z')), false); // 12/01
  assert.equal(isLastDayOfMonth(new Date('2026-02-27T22:30:00Z')), true);  // 2/28
});

test('daily: 가격을 받고, 마지막 날이면 월말 기록을 남긴다', async () => {
  const DB = await seeded();
  const note = await daily({ DB }, { fetchFn: fakeNet, now: new Date('2026-11-29T22:30:00Z') });
  assert.match(note, /가격 갱신 1건, 실패 0건, 환율 없음, 월말 기록 2026-11-30/);
  const q = await DB.prepare('SELECT * FROM quotes').first();
  assert.deepEqual({ ...q }, { ticker: 'KRW-BTC', date: '2026-11-29', close: 150000000, currency: 'KRW', source: 'upbit' });
  const s = await DB.prepare('SELECT * FROM snapshots').first();
  assert.equal(s.date, '2026-11-30');
  assert.equal(s.total, 1500000);
  const j = await DB.prepare("SELECT note FROM job_log WHERE job = 'daily'").first();
  assert.equal(j.note, note);

  const DB2 = await seeded();
  assert.doesNotMatch(await daily({ DB: DB2 }, { fetchFn: fakeNet, now: new Date('2026-11-10T22:30:00Z') }), /월말/);
});

test('Supabase 잠들기 방지: 공개 키로 keepalive를 부르고, 실패하면 오류', async () => {
  const calls = [];
  const env = { SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_KEY: 'sb_publishable_x' };
  const ok = async (url, init) => { calls.push([url, init.headers.apikey]); return new Response('null', { status: 200 }); };
  assert.equal(await supabaseKeepalive(env, ok), 'Supabase 응답 200');
  assert.deepEqual(calls[0], ['https://abc.supabase.co/rest/v1/rpc/keepalive', 'sb_publishable_x']);
  await assert.rejects(supabaseKeepalive(env, async () => new Response('', { status: 404 })), /HTTP 404/);
});

test('runScheduled·worker.scheduled가 작업을 돌린다', async () => {
  assert.equal(await runScheduled({}), '할 일 없음');
  const DB = await seeded();
  assert.match(await runScheduled({ DB }, fakeNet), /가격 갱신 1건/);
  const waits = [];
  await worker.scheduled({ cron: '30 22 * * *' }, {}, { waitUntil: p => waits.push(p) });
  assert.equal(waits.length, 1);
  await Promise.all(waits);
});
