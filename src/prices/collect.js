// 포트폴리오 종목의 종가와 환율을 모아 D1에 저장하고, 화면용 가격 문서를 만든다.
// - 포트폴리오에 있는 종목만 수집한다. 현금(CASH)은 수집하지 않는다.
// - 시장 하나가 통째로 실패해도 나머지는 저장한다. 받지 못한 종목은 직전 종가가 그대로 남는다.
// - 주말·공휴일에는 새 종가가 없을 뿐이므로 오류로 보지 않는다.
import { FETCHERS, fetchFX, localParts } from './sources.js';
import { keyOf, businessDaysBetween } from '../../web/js/rebalance.js';
import { nowIso } from '../lib/http.js';

const CURRENCY = { US: 'USD' };
export const STALE_BUSINESS_DAYS = 3;

export async function loadDoc(env) {
  const row = await env.DB.prepare('SELECT body, version FROM doc WHERE id = 1').first();
  return row ? { doc: JSON.parse(row.body), version: row.version } : { doc: {}, version: 0 };
}

export async function collectPrices(env, { fetchFn = fetch, now = new Date(), fetchers = FETCHERS, fx = fetchFX } = {}) {
  const { doc } = await loadDoc(env);
  const byMarket = {};
  for (const a of doc.assets || []) {
    const key = keyOf(a);
    if (key && fetchers[a.market]) (byMarket[a.market] ||= {})[key] = a.name || key;
  }

  const updated = [], failed = [], errors = {}, stmts = [];
  for (const [market, names] of Object.entries(byMarket)) {
    let got = {};
    try { got = await fetchers[market](Object.keys(names), now, fetchFn); }
    catch (e) { errors[market] = String(e?.message || e).slice(0, 200); }
    for (const [key, name] of Object.entries(names)) {
      const r = got[key];
      if (r) {
        const [date, close, source] = r;
        stmts.push(env.DB.prepare('INSERT OR REPLACE INTO quotes (ticker, date, close, currency, source) VALUES (?, ?, ?, ?, ?)')
          .bind(key, date, close, CURRENCY[market] || 'KRW', source));
        updated.push({ ticker: key, name, date, close, source });
      } else failed.push({ ticker: key, name, market });
    }
  }

  let rate = null;
  const needFx = (doc.assets || []).some(a => a.market === 'US' || (a.market === 'CASH' && a.currency === 'USD')) || !(doc.assets || []).length;
  if (needFx) {
    try { rate = await fx(now, fetchFn); } catch (e) { errors.FX = String(e?.message || e).slice(0, 200); }
    if (rate) stmts.push(env.DB.prepare('INSERT OR REPLACE INTO fx (date, usdkrw, source) VALUES (?, ?, ?)').bind(rate[0], rate[1], rate[2]));
  }

  const result = {
    ranAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    updated, failed,
    fx: rate ? { date: rate[0], usdkrw: rate[1] } : null,
    errors,
  };
  stmts.push(env.DB.prepare('INSERT INTO job_log (ts, job, note) VALUES (?, ?, ?)').bind(nowIso(), 'prices', JSON.stringify(result)));
  await env.DB.batch(stmts);
  return result;
}

// 화면용 가격 문서: { asOf(마지막 수집 시각), fx, fxDate, quotes: { 종목: { close, date, source, stale } }, lastRun }
export async function priceDoc(env, now = new Date()) {
  const today = localParts(now, 'Asia/Seoul').date;
  const { results: rows } = await env.DB.prepare(
    `SELECT q.ticker, q.date, q.close, q.source FROM quotes q
     JOIN (SELECT ticker, MAX(date) AS d FROM quotes GROUP BY ticker) m ON q.ticker = m.ticker AND q.date = m.d`).all();
  const quotes = {};
  for (const r of rows || []) {
    quotes[r.ticker] = { close: r.close, date: r.date, source: r.source, stale: businessDaysBetween(r.date, today) > STALE_BUSINESS_DAYS };
  }
  const f = await env.DB.prepare('SELECT date, usdkrw FROM fx ORDER BY date DESC LIMIT 1').first();
  const run = await env.DB.prepare("SELECT ts, note FROM job_log WHERE job = 'prices' ORDER BY ts DESC LIMIT 1").first();
  let lastRun = null;
  try { lastRun = run ? JSON.parse(run.note) : null; } catch { lastRun = null; }
  return {
    asOf: run ? run.ts : null,
    fx: f ? f.usdkrw : null,
    fxDate: f ? f.date : null,
    quotes,
    lastRun: lastRun && { ranAt: lastRun.ranAt, failed: lastRun.failed || [], errors: lastRun.errors || {} },
  };
}
