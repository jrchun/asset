// 대시보드 매수 초안·도넛 계산 테스트. 실행: node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeBoard, ensureGroups } from '../web/js/rebalance.js';
import { donutSegments, draftFromPlan, stepQty, qtyFromAmount, draftTrades, rebalanceSchedule, cycleOf } from '../web/js/draft.js';

const load = name => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));

test('도넛 조각: 합이 100, 틈만큼 줄고 0은 길이 0', () => {
  const s = donutSegments([30, 0, 70], 0);
  assert.deepEqual(s.map(x => Math.round(x.len)), [30, 0, 70]);
  assert.equal(Math.round(s[2].start), 30);
  const g = donutSegments([50, 50], 1);
  assert.equal(g[0].len, 49); assert.equal(g[1].start, 50.5);
  assert.deepEqual(donutSegments([0, 0]), [{ start: 0, len: 0 }, { start: 0, len: 0 }]);
  assert.equal(donutSegments([100], 1)[0].len, 100, '조각이 하나면 틈 없음');
});

test('매수 초안: 살 종목만, 계획 수량·전일 종가로 채우고 고친 행은 유지', () => {
  const doc = ensureGroups(load('example-portfolio.json')), P = load('example-prices.json');
  const b = computeBoard(doc, P);
  const rows = draftFromPlan(b, P);
  assert.deepEqual(rows.map(r => [r.ticker, r.qty]), [['360750', 24], ['SCHD', 1], ['308620', 34]]);
  assert.ok(rows.every(r => r.on && !r.touched));
  rows[0].qty = 20; rows[0].touched = true;
  const again = draftFromPlan(b, P, rows);
  assert.equal(again[0].qty, 20);
  const t = draftTrades(again, doc.assets, { fx: P.fx, budget: 1000000 });
  assert.equal(t.trades.length, 3);
  again[1].on = false;
  assert.equal(draftTrades(again, doc.assets, { fx: P.fx }).trades.length, 2, '체크를 끈 행은 빠진다');
});

test('수량 조절: 주식은 1주씩, 코인은 1만 원어치씩', () => {
  assert.equal(stepQty({ market: 'KR', unit: 1 }, 3, 1000, 1), 4);
  assert.equal(stepQty({ market: 'KR', unit: 1 }, 0, 1000, -1), 0);
  const btc = { market: 'CRYPTO', unit: 0.0001 };
  assert.equal(stepQty(btc, 0, 100000000, 1), 0.0001);
  assert.equal(stepQty(btc, 0.0003, 100000000, 1), 0.0004);
  assert.equal(qtyFromAmount(btc, 55000, 100000000), 0.0005);
  assert.equal(qtyFromAmount(btc, 1520000, 81441000), 0.0186, '소수 찌꺼기 없이');
  assert.equal(qtyFromAmount({ market: 'US', unit: 1 }, 2000, 1, 1000), 2, '달러 자산은 환율 적용');
});

test('정기 리밸런싱 주기: 이번 달 여부와 다음 예정 달', () => {
  assert.deepEqual(rebalanceSchedule('quarter', 2026, 11), { due: false, next: { year: 2027, month: 1 } });
  assert.deepEqual(rebalanceSchedule('quarter', 2026, 4), { due: true, next: { year: 2026, month: 7 } });
  assert.deepEqual(rebalanceSchedule('half', 2026, 3), { due: false, next: { year: 2026, month: 7 } });
  assert.deepEqual(rebalanceSchedule('year', 2026, 1), { due: true, next: { year: 2027, month: 1 } });
  assert.equal(cycleOf({}), 'year', '정하지 않았으면 연 1회');
  assert.equal(cycleOf({ cycle: 'half' }), 'half');
});
