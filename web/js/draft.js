// 대시보드 화면용 순수 함수: 도넛 조각 계산, 이번 달 매수 초안(체크·수량 조절) 다루기. DOM에 접근하지 않는다.
import { keyOf, localPrice, floorTo, unitOfAsset, isUSD } from './rebalance.js';

// 도넛 조각: 값 목록 → [{ start, len }] (전체 100 기준). 조각 사이 틈(gap)만큼 길이를 줄인다.
export function donutSegments(values, gap = 0.6) {
  const v = values.map(x => Math.max(0, +x || 0)), sum = v.reduce((s, x) => s + x, 0);
  if (!sum) return v.map(() => ({ start: 0, len: 0 }));
  const shown = v.filter(x => x > 0).length, g = shown > 1 ? gap : 0;
  let at = 0;
  return v.map(x => {
    const full = x / sum * 100, seg = { start: at + g / 2, len: Math.max(0, full - g) };
    at += full;
    return x > 0 ? seg : { start: at, len: 0 };
  });
}

// 코인처럼 소수 단위로 사는 자산은 수량 대신 금액(원)으로 조절한다.
export const byAmount = a => a.market === 'CRYPTO';
export const AMOUNT_STEP = 10000;

// 이번 달 매수안 → 초안 행. 이미 고친 행(prev, 종목 코드 기준)은 그대로 둔다.
export function draftFromPlan(b, prices, prev = []) {
  const old = new Map(prev.map(r => [r.ticker, r]));
  const rows = [];
  b.units.forEach((u, i) => {
    if (!(b.plan.q[i] > 0)) return;
    const a = b.UA[i], t = keyOf(a);
    if (old.has(t) && old.get(t).touched) { rows.push(old.get(t)); return; }
    rows.push({ ticker: t, on: true, qty: b.plan.q[i], plan: b.plan.q[i], price: localPrice(prices, a), touched: false });
  });
  // 계획에 없던데 사용자가 추가한 행
  prev.forEach(r => { if (r.extra && !rows.some(x => x.ticker === r.ticker)) rows.push(r); });
  return rows;
}

// −/+ 한 번: 수량은 매매 단위만큼, 금액형은 AMOUNT_STEP 원어치만큼(단위로 내림). 0 미만은 0.
export function stepQty(a, qty, price, dir, fx = 0) {
  const unit = unitOfAsset(a);
  if (byAmount(a) && price > 0) {
    const krwPer = price * (isUSD(a) ? fx : 1);
    const amt = Math.max(0, Math.round(qty * krwPer / AMOUNT_STEP) * AMOUNT_STEP + dir * AMOUNT_STEP);
    return +floorTo(amt / krwPer, unit).toFixed(8);
  }
  return Math.max(0, +(floorTo(+qty || 0, unit) + dir * unit).toFixed(8));
}

// 금액(원)으로 입력했을 때 수량. 매매 단위로 내린다.
export function qtyFromAmount(a, amount, price, fx = 0) {
  const krwPer = price * (isUSD(a) ? fx : 1);
  return krwPer > 0 ? +floorTo(Math.max(0, +amount || 0) / krwPer, unitOfAsset(a)).toFixed(8) : 0;
}

// 체크된 행 → applyTrades에 넘길 체결 목록과 합계
export function draftTrades(rows, assets, { fx = 0, budget = 0 } = {}) {
  const by = new Map((assets || []).map(a => [keyOf(a), a]));
  const trades = [];
  let spent = 0;
  for (const r of rows) {
    const a = by.get(r.ticker);
    if (!a || !r.on || !(+r.qty > 0)) continue;
    const price = a.market === 'CASH' ? 1 : +r.price || 0;
    trades.push({ ticker: r.ticker, side: 'buy', qty: +r.qty, price });
    spent += +r.qty * price * (isUSD(a) ? fx : 1);
  }
  return { trades, spent, carry: Math.max(0, Math.round(budget - spent)) };
}

// 정기 리밸런싱 주기: 리밸런싱하는 달(1~12)
export const CYCLES = { quarter: { label: '분기', months: [1, 4, 7, 10] }, half: { label: '반기', months: [1, 7] }, year: { label: '연 1회', months: [1] } };
export const cycleOf = doc => (CYCLES[doc?.cycle] ? doc.cycle : 'year');
// 이번 달이 리밸런싱하는 달인지와 다음 예정 달. month는 1~12.
export function rebalanceSchedule(cycle, year, month) {
  const ms = (CYCLES[cycle] || CYCLES.year).months;
  const due = ms.includes(month);
  const after = ms.find(m => m > month);
  const next = after ? { year, month: after } : { year: year + 1, month: ms[0] };
  return { due, next };
}
