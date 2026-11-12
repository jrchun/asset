// 가격 출처 응답 해석과 수집·저장(가짜 fetch·가짜 D1). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverDaily, parseYahooChart, parseNaverGold, upbitCloseDate, isFinal, yahooSymbol, fetchCRYPTO, fetchKR } from '../src/prices/sources.js';
import { collectPrices, priceDoc } from '../src/prices/collect.js';
import { fakeD1 } from './fake_d1.js';

const at = iso => new Date(iso); // 시각은 UTC로 적는다. KST = UTC+9

test('오늘 행은 마감(여유 포함) 뒤에만 확정', () => {
  assert.equal(isFinal('2026-11-10', at('2026-11-10T22:30:00Z'), 'Asia/Seoul', '16:00'), true);   // 11/11 07:30 KST
  assert.equal(isFinal('2026-11-11', at('2026-11-10T22:30:00Z'), 'Asia/Seoul', '16:00'), false);
  assert.equal(isFinal('2026-11-11', at('2026-11-11T07:10:00Z'), 'Asia/Seoul', '16:00'), true);   // 16:10 KST
  // 뉴욕 서머타임이 끝난 뒤(EST, UTC−5): 16:30 = 21:30Z
  assert.equal(isFinal('2026-11-10', at('2026-11-10T21:00:00Z'), 'America/New_York', '16:30'), false);
  assert.equal(isFinal('2026-11-10', at('2026-11-10T21:31:00Z'), 'America/New_York', '16:30'), true);
});

test('네이버 일봉: 확정된 마지막 종가', () => {
  const body = `[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
["20261107", 195000, 199000, 194000, 196500, 100, 50.1],
["20261110", 196000, 198000, 195000, 197300, 100, 50.1],
["20261111", 197000, 199500, 196500, 199000, 100, 50.1]]`;
  assert.deepEqual(parseNaverDaily(body, at('2026-11-11T01:00:00Z')), ['2026-11-10', 197300]); // 장중이면 오늘 행 제외
  assert.deepEqual(parseNaverDaily(body, at('2026-11-11T08:00:00Z')), ['2026-11-11', 199000]);
  assert.equal(parseNaverDaily('[]', at('2026-11-11T08:00:00Z')), null);
});

const yahooBody = (closes, offset = -18000) => ({ chart: { result: [{
  meta: { gmtoffset: offset },
  // 각 날짜 09:30 현지 시각(=14:30Z, EST)
  timestamp: closes.map(([d]) => Date.parse(d + 'T14:30:00Z') / 1000),
  indicators: { quote: [{ close: closes.map(([, c]) => c) }] },
}], error: null } });

test('야후 차트: 거래일 날짜, 미확정 오늘 행 제외, 빈 값 건너뜀', () => {
  const body = yahooBody([['2026-11-06', 270.1], ['2026-11-09', 279.52], ['2026-11-10', null], ['2026-11-11', 281]]);
  // 11/11 07:30 KST = 11/10 17:30 EST → 11/10 행은 값이 없으므로 11/09
  assert.deepEqual(parseYahooChart(body, at('2026-11-10T22:30:00Z'), 'America/New_York', '16:30'), ['2026-11-09', 279.52]);
  assert.deepEqual(parseYahooChart(body, at('2026-11-10T22:30:00Z'), 'America/New_York', '16:30', false), ['2026-11-11', 281]);
  assert.equal(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }, new Date(), 'UTC', '00:00'), null);
  assert.equal(yahooSymbol('brk.b'), 'BRK-B');
});

test('KRX 금: 쉼표 있는 종가, 마감 전 오늘 행 제외', () => {
  const rows = [
    { localTradedAt: '2026-11-11T00:00:00+09:00', closePrice: '178,000' },
    { localTradedAt: '2026-11-10T00:00:00+09:00', closePrice: '177,290' },
  ];
  assert.deepEqual(parseNaverGold(rows, at('2026-11-10T22:30:00Z')), ['2026-11-10', 177290]);
});

test('업비트: 09:00 전이면 전날 날짜, 없는 마켓이 섞이면 하나씩 다시 받는다', async () => {
  assert.equal(upbitCloseDate(at('2026-11-10T22:30:00Z')), '2026-11-10'); // 11/11 07:30 KST
  assert.equal(upbitCloseDate(at('2026-11-11T01:00:00Z')), '2026-11-11'); // 11/11 10:00 KST
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const m = new URL(url).searchParams.get('markets');
    if (m.includes('KRW-NOPE')) return new Response('{"error":{}}', { status: 404 });
    return new Response(JSON.stringify(m.split(',').map(x => ({ market: x, prev_closing_price: 152000000 }))));
  };
  const out = await fetchCRYPTO(['KRW-BTC', 'KRW-NOPE'], at('2026-11-10T22:30:00Z'), fetchFn);
  assert.deepEqual(out, { 'KRW-BTC': ['2026-11-10', 152000000, 'upbit'] });
  assert.equal(calls.length, 3);
});

test('국내: 네이버가 실패하면 야후 .KS → .KQ 순서로 다시 받는다', async () => {
  const fetchFn = async url => {
    if (url.includes('naver')) return new Response('', { status: 500 });
    if (url.includes('.KS')) return new Response('{"chart":{"result":null,"error":{"code":"Not Found"}}}', { status: 404 });
    return new Response(JSON.stringify(yahooBody([['2026-11-10', 41200]], 32400)));
  };
  assert.deepEqual(await fetchKR(['123456'], at('2026-11-10T22:30:00Z'), fetchFn), { '123456': ['2026-11-10', 41200, 'yahoo'] });
});

async function seed(DB, doc) {
  await DB.prepare("INSERT INTO doc (id, body, version, updated_at) VALUES (1, ?, 1, 'x')").bind(JSON.stringify(doc)).run();
}

test('수집: 시장 하나가 통째로 실패해도 나머지는 저장, 실패 종목은 직전 종가 유지', async () => {
  const DB = fakeD1();
  await seed(DB, { assets: [
    { name: '삼성전자', ticker: '005930', market: 'KR' },
    { name: 'QQQM', ticker: 'QQQM', market: 'US' },
    { name: '현금', ticker: 'CASH1', market: 'CASH' },
  ] });
  await DB.prepare("INSERT INTO quotes VALUES ('QQQM', '2026-11-05', 270, 'USD', 'yahoo')").run();
  const now = at('2026-11-10T22:30:00Z');
  const r = await collectPrices({ DB }, {
    now,
    fetchers: {
      KR: async t => ({ [t[0]]: ['2026-11-10', 197300, 'naver'] }),
      US: async () => { throw new Error('막힘'); },
    },
    fx: async () => ['2026-11-11', 1385.5, 'yahoo'],
  });
  assert.deepEqual(r.updated.map(x => x.ticker), ['005930']);
  assert.deepEqual(r.failed.map(x => x.ticker), ['QQQM']);
  assert.equal(r.errors.US, '막힘');
  const P = await priceDoc({ DB }, now);
  assert.deepEqual(P.quotes['005930'], { close: 197300, date: '2026-11-10', source: 'naver', stale: false });
  assert.equal(P.quotes.QQQM.close, 270);
  assert.equal(P.quotes.QQQM.stale, true, '11/05 → 11/11은 4영업일');
  assert.equal(P.quotes.CASH1, undefined, '현금은 수집하지 않는다');
  assert.equal(P.fx, 1385.5);
  assert.ok(P.asOf);
  assert.deepEqual(P.lastRun.failed.map(x => x.ticker), ['QQQM']);
});
