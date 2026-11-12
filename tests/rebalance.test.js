// 계산 모듈 테스트 벡터(요청서 6장). 실행: node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { computeBoard, ensureGroups, keyOf, allocateContribution, maxDrift, statusOf, applyTrades, businessDaysBetween, snapshotOf, krwPrice } from '../web/js/rebalance.js';

const data = name => new URL('../data/' + name, import.meta.url);
const load = name => JSON.parse(readFileSync(data(name), 'utf8'));
// 매수 행: 종목 코드 → { q, amt, blocked }
function buyRows(b) {
  const rows = {};
  b.units.forEach((u, i) => { rows[keyOf(b.UA[i])] = { q: b.plan.q[i], amt: b.plan.amt[i], blocked: b.plan.blocked[i] }; });
  return rows;
}

test('경우 1: 종목별 목표, 예산 1,000,000원', () => {
  const doc = ensureGroups(load('example-portfolio.json'));
  const b = computeBoard(doc, load('example-prices.json'));
  const rows = buyRows(b);
  assert.equal(b.budget, 1000000);
  assert.deepEqual(
    Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.q])),
    { '360750': 24, '069500': 0, QQQ: 0, SCHD: 1, '308620': 34, 'KRW-BTC': 0 },
  );
  assert.equal(rows.QQQ.blocked, true, 'QQQ는 배정액이 1주 가격에 못 미쳐 보류');
  assert.equal(rows['069500'].blocked, false);
  assert.equal(Math.round(b.plan.spent), 997003);
  assert.equal(Math.round(b.budget - b.plan.spent), 2997);
});

// 개인 포트폴리오는 저장소에 올리지 않는다. 파일이 있는 기기에서만 확인한다.
const seedFiles = ['seed-portfolio.json', 'seed-prices.json', 'seed-expected.json'];
const hasSeed = seedFiles.every(f => existsSync(data(f)));
test('경우 2: seed-portfolio.json + seed-prices.json', { skip: !hasSeed && 'data/seed-*.json 없음' }, () => {
  const expected = load('seed-expected.json');
  const b = computeBoard(ensureGroups(load('seed-portfolio.json')), load('seed-prices.json'));
  const rows = buyRows(b);
  assert.equal(b.budget, expected.budget);
  for (const [code, q] of Object.entries(expected.buys)) {
    assert.ok(rows[code], code + ' 매수 행이 있어야 한다');
    assert.equal(rows[code].q, q, code + ' 매수 수량');
  }
  for (const code of expected.blocked) assert.equal(rows[code].blocked, true, code + ' 보류');
  for (const code of expected.absent) assert.equal(rows[code], undefined, code + '는 매수 행에 나오지 않는다');
  assert.equal(Math.round(b.plan.spent), expected.spent);
});

test('allocateContribution: 부족분이 예산보다 크면 부족분 비율대로, 작으면 채우고 나머지를 목표대로', () => {
  assert.deepEqual(allocateContribution([0, 100], [0.5, 0.5], 50), [50, 0]);
  assert.deepEqual(allocateContribution([40, 60], [0.5, 0.5], 100), [60, 40]);
  assert.deepEqual(allocateContribution([50, 50], [0.5, 0.5], 10), [5, 5]);
});

test('상태 판정: 밴드 절반 이하 양호, 밴드 이하 주의, 초과 리밸런싱 필요', () => {
  assert.equal(statusOf(2.5, 5), 'ok');
  assert.equal(statusOf(5, 5), 'warn');
  assert.equal(statusOf(5.1, 5), 'bad');
  assert.equal(maxDrift([60, 40], [0.5, 0.5]), 10);
});

test('exclude 자산은 비중 계산에서 빠지고, 미분류 종목은 목표 0%인 단위가 된다', () => {
  const doc = {
    monthly: 0, band: 5,
    groups: [{ id: 'a', name: 'A', target: 100, mode: 'ratio' }],
    assets: [
      { name: 'X', ticker: 'X', market: 'KR', qty: 10, avg: 100, unit: 1, group: 'a' },
      { name: 'Y', ticker: 'Y', market: 'KR', qty: 10, avg: 100, unit: 1 },
      { name: '보증금', ticker: 'CASH-J', market: 'CASH', qty: 5000, avg: 1, unit: 1, exclude: true },
    ],
  };
  const b = computeBoard(doc, { quotes: { X: { close: 100 } } });
  assert.equal(b.T, 2000);
  assert.equal(b.exVal, 5000);
  assert.deepEqual(b.missing.map(a => a.name), ['Y']);
  assert.deepEqual(b.loose.map(u => u.label), ['Y']);
  assert.deepEqual(b.uw, [1, 0]);
});

test('1월 리밸런싱: 대표형 그룹은 sell 종목부터 팔고 보유 수량을 넘기지 않는다', () => {
  const doc = {
    monthly: 0, band: 5,
    groups: [
      { id: 'g', name: 'G', target: 20, mode: 'lead', lead: 'A', sell: 'B' },
      { id: 'h', name: 'H', target: 80, mode: 'ratio' },
    ],
    assets: [
      { name: 'A', ticker: 'A', market: 'KR', qty: 50, avg: 100, unit: 1, group: 'g' },
      { name: 'B', ticker: 'B', market: 'US', qty: 2, avg: 5, unit: 1, group: 'g' },
      { name: 'C', ticker: 'C', market: 'KR', qty: 20, avg: 100, unit: 1, group: 'h' },
    ],
  };
  // A 5,000 + B 2×10×1,000 = 20,000 + C 2,000 → 합 27,000. G 목표 5,400, 초과 19,600
  const b = computeBoard(doc, { fx: 1000, quotes: { A: { close: 100 }, B: { close: 10 }, C: { close: 100 } } });
  const [a, bb, c] = b.annual.act;
  assert.deepEqual({ q: bb.q, s: bb.s }, { q: 1, s: -1 }); // 19,600 ÷ 10,000 → 1주
  assert.deepEqual({ q: a.q, s: a.s }, { q: 50, s: -1 });  // 남은 9,600 → 96주가 필요하지만 보유 50주까지만
  assert.deepEqual({ q: c.q, s: c.s }, { q: 196, s: 1 });
  assert.equal(b.annual.usGain, 1 * (10 - 5) * 1000);
});

test('3영업일 넘게 갱신되지 않은 종가는 stale 목록에 들어간다(현금 제외)', () => {
  const doc = {
    monthly: 0, band: 5, groups: [],
    assets: [
      { name: 'X', ticker: 'X', market: 'KR', qty: 1, avg: 1, unit: 1 },
      { name: 'Y', ticker: 'Y', market: 'KR', qty: 1, avg: 1, unit: 1 },
      { name: '현금', ticker: 'C', market: 'CASH', qty: 1, avg: 1, unit: 1 },
    ],
  };
  const b = computeBoard(doc, { quotes: { X: { close: 1, date: '11/01', stale: true }, Y: { close: 1, date: '11/10' }, C: { close: 1, stale: true } } });
  assert.deepEqual(b.stale.map(a => a.name), ['X']);
});

test('달러 현금: 통화 USD면 환율을 곱해 평가하고, 매수안 단위는 달러', () => {
  const doc = {
    monthly: 100000, band: 5,
    groups: [{ id: 'c', name: '현금', target: 100, mode: 'ratio' }],
    assets: [{ name: '외화RP', ticker: 'CASH1', market: 'CASH', currency: 'USD', qty: 100, avg: 1, unit: 0.01, group: 'c' }],
  };
  const P = { fx: 1400, quotes: {} };
  assert.equal(krwPrice(P, doc.assets[0]), 1400);
  const b = computeBoard(doc, P);
  assert.equal(b.T, 140000);
  assert.deepEqual(b.missing, [], '현금은 가격 누락 경고에 넣지 않는다');
  assert.equal(b.plan.q[0], 71.42); // 100,000원 ÷ 1,400원 = 71.428… → 0.01달러 단위 내림
});

test('체결 반영: 수량·평균단가·이월 현금(손계산)', () => {
  const doc = {
    monthly: 1000000, carry: 20000, band: 5,
    assets: [
      { name: 'A', ticker: '360750', market: 'KR', qty: 10, avg: 20000, unit: 1 },
      { name: 'Q', ticker: 'QQQ', market: 'US', qty: 2, avg: 500, unit: 1 },
      { name: 'S', ticker: 'SCHD', market: 'US', qty: 10, avg: 25, unit: 1 },
    ],
  };
  const r = applyTrades(doc, [
    { ticker: '360750', side: 'buy', qty: 20, price: 23000 },  // 460,000원
    { ticker: 'qqq', side: 'buy', qty: 1, price: 600 },        // 600 × 1,400 = 840,000원
    { ticker: 'SCHD', side: 'sell', qty: 4, price: 28 },       // 4 × 28 × 1,400 = 156,800원
    { ticker: 'NONE', side: 'buy', qty: 1, price: 1 },         // 없는 종목은 무시
  ], { fx: 1400 });
  const [a, q, s] = r.doc.assets;
  assert.equal(a.qty, 30);
  assert.equal(a.avg, 22000);                 // (10×20,000 + 20×23,000) ÷ 30
  assert.equal(q.qty, 3);
  assert.equal(q.avg, 533.3333);              // (2×500 + 600) ÷ 3, 달러는 소수 넷째 자리
  assert.deepEqual([s.qty, s.avg], [6, 25]);  // 매도는 평균단가 유지
  assert.equal(r.doc.carry, 0);               // 1,020,000 − 1,300,000 + 156,800 = −123,200 → 0
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[1], { ticker: 'QQQ', side: 'buy', qty: 1, price: 600, currency: 'USD', fx: 1400 });
  assert.equal(doc.assets[0].qty, 10, '원래 문서는 고치지 않는다');

  const r2 = applyTrades(doc, [{ ticker: '360750', side: 'buy', qty: 40, price: 23000 }], { fx: 1400 });
  assert.equal(r2.doc.carry, 100000);         // 1,020,000 − 920,000
  assert.throws(() => applyTrades(doc, [{ ticker: 'QQQ', side: 'buy', qty: 1, price: 600 }], {}), /환율/);
});

test('경우 1의 매수안을 그대로 반영하면 이월 현금 = 남는 현금 2,997원', () => {
  const doc = ensureGroups(load('example-portfolio.json'));
  const P = load('example-prices.json');
  const b = computeBoard(doc, P);
  const trades = b.units.map((u, i) => ({ ticker: keyOf(b.UA[i]), side: 'buy', qty: b.plan.q[i], price: P.quotes[keyOf(b.UA[i])].close })).filter(t => t.qty > 0);
  const r = applyTrades(doc, trades, { fx: P.fx });
  assert.equal(r.doc.carry, 2997);
  assert.equal(r.doc.assets.find(a => a.ticker === '360750').qty, 544);
});

test('영업일 계산과 월말 기록', () => {
  assert.equal(businessDaysBetween('2026-11-06', '2026-11-09'), 1); // 금 → 월
  assert.equal(businessDaysBetween('2026-11-05', '2026-11-11'), 4);
  assert.equal(businessDaysBetween('2026-11-11', '2026-11-11'), 0);
  const snap = snapshotOf(load('example-portfolio.json'), load('example-prices.json'));
  assert.equal(snap.assets.length, 6);
  assert.equal(Math.round(snap.groups.reduce((x, g) => x + g.weight, 0)), 100);
  assert.equal(Math.round(snap.total), Math.round(snap.assets.reduce((x, a) => x + a.value, 0)));
});
