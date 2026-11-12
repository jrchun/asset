// 시장별 종가 출처. 모두 API 키가 필요 없다. 각 함수는 fetch(tickers, now, fetchFn) → { 종목코드: [날짜, 종가, 출처] }.
// 받지 못한 종목은 결과에 넣지 않는다(직전 종가가 그대로 남는다).
//
// | 시장   | 출처                                                        | 비고 |
// |--------|-------------------------------------------------------------|------|
// | KR     | 네이버 금융 일봉 → 없으면 야후 차트(.KS → .KQ)              | 네이버 주소는 공식 문서가 없다 |
// | US     | 야후 차트 API(query1 → query2)                              | 비공식. BRK.B → BRK-B |
// | 환율   | 야후 차트 `KRW=X`                                           | 수집 시점 값 |
// | CRYPTO | 업비트 `GET /v1/ticker` 의 prev_closing_price               | 공식 공개 API |
// | GOLD   | 네이버 증권 "국내 금"(M04020000)                             | 공식 문서가 없다 |
// 장중에는 오늘 행이 실시간 값이므로, 오늘 날짜 행은 그 시장 마감(여유 포함) 뒤에만 받는다.

const UA = 'Mozilla/5.0 (compatible; rebalance-board/1.0; personal portfolio tool)';
const TZ_KR = 'Asia/Seoul', TZ_NY = 'America/New_York';

export async function getText(fetchFn, url) {
  const r = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0]);
  return r.text();
}
const getJson = async (fetchFn, url) => JSON.parse(await getText(fetchFn, url));

// 어느 시간대의 날짜(YYYY-MM-DD)와 시각(HH:MM)
export function localParts(now, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
// 그 날짜의 종가가 확정됐는가: 지난 날짜면 확정, 오늘이면 마감 시각(closeAfter, 'HH:MM')이 지났을 때만.
export function isFinal(day, now, timeZone, closeAfter) {
  const l = localParts(now, timeZone);
  return day < l.date || (day === l.date && l.hm >= closeAfter);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- 네이버 금융 일봉 (국내 주식·ETF) ---------- */
// 응답 행: ["20261110", 시가, 고가, 저가, 종가, 거래량, 외국인소진율]
export function parseNaverDaily(text, now) {
  let best = null;
  for (const m of String(text).matchAll(/\[\s*["'](\d{8})["']\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g)) {
    const d = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`, close = +m[5];
    if (close > 0 && isFinal(d, now, TZ_KR, '16:00') && (!best || d > best[0])) best = [d, close];
  }
  return best;
}
async function naverKr(code, now, fetchFn) {
  const today = localParts(now, TZ_KR).date.replace(/-/g, ''), start = addDays(localParts(now, TZ_KR).date, -21).replace(/-/g, '');
  const url = `https://fchart.stock.naver.com/siseJson.nhn?symbol=${encodeURIComponent(code)}&requestType=1&timeframe=day&startTime=${start}&endTime=${today}`;
  return parseNaverDaily(await getText(fetchFn, url), now);
}

/* ---------- 야후 차트 (미국 주식·ETF, 환율, 국내 보조) ---------- */
export const yahooSymbol = t => String(t).trim().toUpperCase().replace(/[./]/g, '-');
// 확정된 마지막 종가. final=false면 마지막 값을 그대로(환율용).
export function parseYahooChart(body, now, timeZone, closeAfter, final = true) {
  const r = body?.chart?.result?.[0];
  if (!r || !Array.isArray(r.timestamp)) return null;
  const off = +r.meta?.gmtoffset || 0, closes = r.indicators?.quote?.[0]?.close || [];
  let best = null;
  r.timestamp.forEach((ts, i) => {
    const c = +closes[i];
    if (!(c > 0)) return;
    const d = new Date((ts + off) * 1000).toISOString().slice(0, 10);
    if (final && !isFinal(d, now, timeZone, closeAfter)) return;
    if (!best || d >= best[0]) best = [d, +c.toFixed(4)];
  });
  return best;
}
async function yahoo(symbol, fetchFn) {
  let last;
  for (const host of ['query1', 'query2']) {
    try { return await getJson(fetchFn, `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`); }
    catch (e) { last = e; }
  }
  throw last;
}

/* ---------- 시장별 fetch ---------- */
async function eachTicker(tickers, fn) {
  const out = {};
  for (const t of tickers) {
    try { const r = await fn(t); if (r) out[t] = r; } catch { /* 이 종목만 실패: 직전 종가 유지 */ }
  }
  return out;
}

export function fetchKR(tickers, now, fetchFn) {
  return eachTicker(tickers, async code => {
    try { const r = await naverKr(code, now, fetchFn); if (r) return [...r, 'naver']; } catch { /* 야후로 다시 */ }
    for (const sfx of ['.KS', '.KQ']) {
      try { const r = parseYahooChart(await yahoo(code + sfx, fetchFn), now, TZ_KR, '16:00'); if (r) return [...r, 'yahoo']; } catch { /* 다음 접미사 */ }
    }
    return null;
  });
}

export function fetchUS(tickers, now, fetchFn) {
  return eachTicker(tickers, async t => {
    const r = parseYahooChart(await yahoo(yahooSymbol(t), fetchFn), now, TZ_NY, '16:30');
    return r ? [...r, 'yahoo'] : null;
  });
}

export async function fetchFX(now, fetchFn) {
  const r = parseYahooChart(await yahoo('KRW=X', fetchFn), now, TZ_KR, '00:00', false);
  return r ? [...r, 'yahoo'] : null;
}

// 업비트 일봉은 KST 09:00에 바뀐다. prev_closing_price의 날짜는 그 종가가 정해진 직전 09:00의 날짜.
export function upbitCloseDate(now) {
  const l = localParts(now, TZ_KR);
  return l.hm >= '09:00' ? l.date : addDays(l.date, -1);
}
export async function fetchCRYPTO(tickers, now, fetchFn) {
  const markets = tickers.map(t => String(t).trim().toUpperCase());
  const base = 'https://api.upbit.com/v1/ticker?markets=';
  let rows = [];
  try { rows = await getJson(fetchFn, base + markets.join(',')); }
  catch {
    // 없는 마켓이 하나라도 있으면 업비트가 요청 전체를 404로 거절한다 → 하나씩 다시
    for (const m of markets) { try { rows = rows.concat(await getJson(fetchFn, base + m)); } catch { /* 이 종목만 실패 */ } }
  }
  const d = upbitCloseDate(now), out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const close = +r?.prev_closing_price;
    if (close > 0 && markets.includes(r.market)) out[r.market] = [d, close, 'upbit'];
  }
  return out;
}

export const GOLD_CODE = 'M04020000';
// 응답: [{ localTradedAt: "2026-11-10T00:00:00+09:00", closePrice: "177,290" }, ...]
export function parseNaverGold(rows, now) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r?.localTradedAt || '').slice(0, 10), close = +String(r?.closePrice ?? '').replace(/,/g, '');
    if (/^\d{4}-\d\d-\d\d$/.test(d) && close > 0 && isFinal(d, now, TZ_KR, '16:00') && (!best || d > best[0])) best = [d, close];
  }
  return best;
}
export async function fetchGOLD(tickers, now, fetchFn) {
  const wanted = tickers.filter(t => String(t).trim().toUpperCase() === GOLD_CODE);
  if (!wanted.length) return {};
  const r = parseNaverGold(await getJson(fetchFn, `https://api.stock.naver.com/marketindex/metals/${GOLD_CODE}/prices?page=1&pageSize=10`), now);
  return r ? Object.fromEntries(wanted.map(t => [t, [...r, 'naver']])) : {};
}

export const FETCHERS = { KR: fetchKR, US: fetchUS, GOLD: fetchGOLD, CRYPTO: fetchCRYPTO };
