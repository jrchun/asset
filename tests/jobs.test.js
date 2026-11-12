// 예약 작업(src/jobs.js)과 Worker의 scheduled() 연결(가짜 D1·fetch로 확인). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { daily, runScheduled, supabaseKeepalive } from '../src/jobs.js';

function fakeDB(count = 3) {
  const log = [];
  return {
    log,
    prepare: sql => ({
      first: async () => ({ n: count }),
      bind: (...args) => ({ run: async () => { log.push([sql, args]); return { meta: { changes: 1 } }; } }),
    }),
  };
}

test('daily: 사용 기록 수를 job_log에 남긴다', async () => {
  const DB = fakeDB(3);
  assert.equal(await daily({ DB }), '사용 기록 3건');
  assert.match(DB.log[0][0], /INSERT INTO job_log/);
  assert.equal(DB.log[0][1][1], 'daily');
  assert.equal(DB.log[0][1][2], '사용 기록 3건');
});

test('Supabase 잠들기 방지: 공개 키로 keepalive를 부르고, 실패하면 오류', async () => {
  const calls = [];
  const env = { SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_KEY: 'sb_publishable_x' };
  const ok = async (url, init) => { calls.push([url, init.headers.apikey]); return new Response('null', { status: 200 }); };
  assert.equal(await supabaseKeepalive(env, ok), 'Supabase 응답 200');
  assert.deepEqual(calls[0], ['https://abc.supabase.co/rest/v1/rpc/keepalive', 'sb_publishable_x']);
  await assert.rejects(supabaseKeepalive(env, async () => new Response('', { status: 404 })), /HTTP 404/);
});

test('runScheduled: 모드에 맞는 작업만 한다', async () => {
  assert.equal(await runScheduled({ DB: fakeDB(0) }), '사용 기록 0건');
  assert.equal(await runScheduled({}), '할 일 없음');
  const fetchFn = async () => new Response('null', { status: 200 });
  assert.equal(await runScheduled({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_KEY: 'k' }, fetchFn), 'Supabase 응답 200');
});

test('worker.scheduled가 작업을 waitUntil로 넘긴다', async () => {
  const DB = fakeDB(1), waits = [];
  await worker.scheduled({ cron: '30 22 * * *' }, { DB }, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  assert.equal(DB.log.length, 1);
});
