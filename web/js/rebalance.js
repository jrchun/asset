// 리밸런싱 계산. DOM에 접근하지 않는 순수 함수만 둔다(화면은 app.js, Worker도 이 파일을 가져다 쓴다).
// 계산 로직은 시안(reference/rebalance-board.html)의 buildUnits·allocateContribution·planMonthly·maxDrift·
// 1월 리밸런싱 블록을 그대로 옮겼다. 바꾸면 tests/rebalance.test.js의 테스트 벡터를 함께 확인한다.
//
// 포트폴리오 문서: { monthly, carry, band, groups:[{id,name,target,mode,lead,sell}], assets:[{name,ticker,market,currency,qty,avg,unit,account,group,inner,exclude,manual}] }
// 가격 문서:       { asOf, fx, quotes: { TICKER: { close, date, stale } } }

export const keyOf = a => String(a?.ticker || '').trim().toUpperCase();
// 달러로 값을 매기는 자산: 미국 상장 종목, 그리고 통화를 USD로 고른 현금(외화RP 등).
export const isUSD = a => a.market === 'US' || (a.market === 'CASH' && a.currency === 'USD');
export const floorTo = (q, unit) => unit > 0 ? Math.floor(q / unit + 1e-9) * unit : q;
export const unitOfAsset = a => +a.unit || 1;

export function quoteOf(prices, a) {
  const q = prices?.quotes?.[keyOf(a)];
  return q && +q.close > 0 ? q : null;
}
export const fxOf = prices => (+prices?.fx > 0 ? +prices.fx : null);
// 자산 통화 기준 1단위 가격. 종가가 없으면 평균단가로 대신한다. 현금은 1.
export function localPrice(prices, a) {
  if (a.market === 'CASH') return 1;
  const q = quoteOf(prices, a);
  return q ? +q.close : (+a.avg || 0);
}
export function krwPrice(prices, a) {
  const p = localPrice(prices, a);
  return isUSD(a) ? p * (fxOf(prices) || 0) : p;
}

/* ---------- 리밸런싱 수학 ---------- */
export function allocateContribution(values, weights, C) {
  const T2 = values.reduce((s, v) => s + v, 0) + C;
  const deficit = values.map((v, i) => Math.max(0, weights[i] * T2 - v));
  const D = deficit.reduce((s, d) => s + d, 0);
  if (D <= 0) return weights.map(w => w * C);
  if (D <= C) return deficit.map((d, i) => d + weights[i] * (C - D));
  return deficit.map(d => d / D * C);
}

export function maxDrift(values, weights) {
  const T = values.reduce((s, v) => s + v, 0); if (!T) return 0;
  return Math.max(0, ...values.map((v, i) => Math.abs(v / T * 100 - weights[i] * 100)));
}

// 정액식 적립: 부족분에 배분 → 매매 단위로 내림 → 남은 돈으로 가장 부족한 단위부터 1매매단위씩 추가
export function planMonthly(UA, vals, w, budget, prices) {
  const n = UA.length, price = UA.map(a => krwPrice(prices, a)), unit = UA.map(unitOfAsset);
  const raw = allocateContribution(vals, w, budget);
  const q = raw.map((x, i) => price[i] > 0 ? floorTo(x / price[i], unit[i]) : 0);
  const T2 = vals.reduce((s, v) => s + v, 0) + budget;
  let spent = q.reduce((s, x, i) => s + x * price[i], 0);
  for (let guard = 0; guard < 500; guard++) {
    let best = -1, bestGap = 0;
    for (let i = 0; i < n; i++) {
      const step = unit[i] * price[i];
      if (!(price[i] > 0) || !(w[i] > 0) || step > budget - spent + 1e-6) continue;
      const gap = w[i] * T2 - (vals[i] + q[i] * price[i]);
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) break;
    q[best] = +(q[best] + unit[best]).toFixed(8); spent += unit[best] * price[best];
  }
  const amt = q.map((x, i) => x * price[i]);
  const blocked = raw.map((x, i) => x >= 1 && q[i] <= 0);
  return { raw, q, amt, spent, blocked, price };
}

export function statusOf(md, band) {
  return md <= band / 2 ? 'ok' : md <= band ? 'warn' : 'bad';
}
export const STATUS_LABEL = { ok: '양호', warn: '주의', bad: '리밸런싱 필요' };

// 그룹이 없던 예전 문서(종목마다 target)를 종목 하나짜리 비율형 그룹으로 바꾼다. 문서를 고쳐서 돌려준다.
export function ensureGroups(doc) {
  if (!Array.isArray(doc.assets)) doc.assets = [];
  if (!Array.isArray(doc.groups)) {
    doc.groups = [];
    doc.assets.forEach((a, i) => {
      if (a.exclude) return;
      const id = 'g' + (i + 1);
      doc.groups.push({ id, name: a.name, target: +a.target || 0, mode: 'ratio' });
      a.group = id;
    });
  }
  return doc;
}

// 리밸런싱 단위: 비율형 그룹은 종목마다 1단위, 대표형 그룹(종목 2개 이상)은 그룹 전체가 1단위, 미분류 종목은 목표 0%인 1단위
export function buildUnits(groups, A, vals) {
  groups = groups || [];
  const units = [], loose = [];
  const byG = new Map(groups.map(g => [g.id, []]));
  A.forEach((a, i) => {
    if (byG.has(a.group)) byG.get(a.group).push(i);
    else loose.push({ g: null, idx: [i], buy: i, sellOrder: [i], w: 0, val: vals[i], label: a.name });
  });
  const live = groups.filter(g => byG.get(g.id).length);
  const tSum = live.reduce((x, g) => x + (+g.target || 0), 0);
  live.forEach(g => {
    const M = byG.get(g.id), gw = tSum ? (+g.target || 0) / tSum : 0;
    if (g.mode === 'lead' && M.length > 1) {
      const buy = M.find(i => keyOf(A[i]) === String(g.lead || '').toUpperCase()) ?? M[0];
      const sf = M.find(i => keyOf(A[i]) === String(g.sell || '').toUpperCase()) ?? buy;
      units.push({ g, idx: M, buy, sellOrder: [sf, ...M.filter(i => i !== sf)], w: gw, val: M.reduce((x, i) => x + vals[i], 0), label: g.name, lead: true });
    } else {
      const inn = M.map(i => Math.max(0, +(A[i].inner ?? 1) || 0)), sum = inn.reduce((x, y) => x + y, 0);
      M.forEach((i, k) => units.push({ g, idx: [i], buy: i, sellOrder: [i], w: gw * (sum ? inn[k] / sum : 1 / M.length), val: vals[i], label: A[i].name }));
    }
  });
  return { units: units.concat(loose), live, byG, tSum, loose };
}

// 적립만으로 밴드 안에 들어오기까지 걸리는 달 수(가격 변동 없다고 가정). null = 해당 없음, 0 이하 적립금이면 'none'
export function monthsToResolve(uv, uw, C, band) {
  const md = maxDrift(uv, uw);
  if (md <= band) return { kind: 'na' };
  if (!(C > 0)) return { kind: 'none' };
  let months = 0, v = uv.slice();
  while (maxDrift(v, uw) > band && months < 120) {
    const add = allocateContribution(v, uw, C);
    v = v.map((x, i) => x + add[i]); months++;
  }
  return { kind: 'months', months };
}

// 1월 정기 리밸런싱: 단위별 목표 금액과의 차이만큼 매수(대표·해당 종목) 또는 매도(먼저 매도 종목부터, 보유 수량까지)
export function planAnnual(A, units, uv, uw, TT, prices) {
  let sells = 0, buys = 0, usGain = 0;
  const act = A.map(() => null);
  const fx = fxOf(prices) || 0;
  units.forEach((u, k) => {
    const diff = uw[k] * TT - uv[k];
    if (diff > 0) {
      const i = u.buy, up = krwPrice(prices, A[i]), un = unitOfAsset(A[i]), q = up > 0 ? floorTo(diff / up, un) : 0;
      if (q > 0) { act[i] = { q, amt: q * up, s: 1 }; buys += q * up; }
    } else if (diff < 0) {
      let rem = -diff;
      for (const i of u.sellOrder) {
        const a = A[i], up = krwPrice(prices, a), un = unitOfAsset(a); if (!(up > 0)) continue;
        const q = Math.min(floorTo(rem / up, un), floorTo(+a.qty || 0, un));
        if (q > 0) {
          act[i] = { q, amt: q * up, s: -1 }; sells += q * up; rem -= q * up;
          if (a.market === 'US') usGain += q * (localPrice(prices, a) - (+a.avg || 0)) * fx;
        }
        if (rem < 1) break;
      }
    }
  });
  return { act, sells, buys, usGain };
}

// 대시보드에 필요한 숫자를 한 번에 계산한다.
export function computeBoard(doc, prices) {
  prices = prices || { quotes: {} };
  const ALL = doc.assets || [], A = ALL.filter(a => !a.exclude), EXA = ALL.filter(a => a.exclude);
  const fx = fxOf(prices);
  const exVal = EXA.reduce((x, a) => x + (+a.qty || 0) * krwPrice(prices, a), 0);
  const vals = A.map(a => (+a.qty || 0) * krwPrice(prices, a));
  const cost = A.map(a => (+a.qty || 0) * (+a.avg || 0) * (isUSD(a) ? (fx || 0) : 1));
  const T = vals.reduce((s, v) => s + v, 0), TC = cost.reduce((s, v) => s + v, 0);
  const C = Math.max(0, +doc.monthly || 0);
  const band = Math.max(0.1, +doc.band || 5);
  const { units, live, byG, tSum, loose } = buildUnits(doc.groups, A, vals);
  const uv = units.map(u => u.val), uw = units.map(u => u.w);

  const missing = A.filter(a => a.market !== 'CASH' && !quoteOf(prices, a));
  const stale = A.filter(a => a.market !== 'CASH' && quoteOf(prices, a)?.stale);
  const needFx = A.some(isUSD) && !fx;

  const cur = vals.map(v => T ? v / T * 100 : 0);
  const uDrift = uv.map((v, k) => (T ? v / T * 100 : 0) - uw[k] * 100);
  const md = maxDrift(uv, uw);
  const mdIdx = uDrift.reduce((bi, d, i) => Math.abs(d) > Math.abs(uDrift[bi]) ? i : bi, 0);
  const status = statusOf(md, band);
  const months = monthsToResolve(uv, uw, C, band);

  const carry = Math.max(0, +doc.carry || 0), budget = C + carry;
  const UA = units.map(u => A[u.buy]);
  const plan = planMonthly(UA, uv, uw, budget, prices);
  const after = uv.map((x, i) => x + plan.amt[i]);
  const T2 = after.reduce((s, x) => s + x, 0);
  const md2 = maxDrift(after, uw);

  const annual = planAnnual(A, units, uv, uw, T + budget, prices);
  annual.rest = budget + annual.sells - annual.buys;

  const groupRows = live.map(g => ({ id: g.id, name: g.name, cur: byG.get(g.id).reduce((x, i) => x + cur[i], 0), tgt: tSum ? (+g.target || 0) / tSum * 100 : 0 }));
  if (loose.length) groupRows.push({ id: null, name: '미분류', cur: loose.reduce((x, u) => x + (T ? u.val / T * 100 : 0), 0), tgt: 0 });
  const unitIndexOf = i => units.findIndex(u => u.idx.includes(i));

  return {
    A, EXA, exVal, vals, cost, T, TC, pl: T - TC, C, band, fx,
    units, live, byG, tSum, loose, uv, uw, UA,
    missing, stale, needFx, cur, uDrift, md, mdIdx, status, months,
    carry, budget, plan, after, T2, md2, annual, groupRows, unitIndexOf,
  };
}

// 목표 합계(종목이 있는 그룹만)
export function targetSum(doc) {
  const A = (doc.assets || []).filter(a => !a.exclude);
  return (doc.groups || []).filter(g => A.some(a => a.group === g.id)).reduce((x, g) => x + (+g.target || 0), 0);
}

/* ---------- 체결 반영 ---------- */
// trades: [{ ticker, side: 'buy'|'sell', qty, price(자산 통화 기준) }]
// 새 수량 = 기존 + 체결, 새 평균단가 = (기존 수량×기존 평균단가 + 체결 수량×체결가) ÷ 새 수량. 매도는 수량만 줄인다.
// 이월 현금 = 예산 − 실제 매수 금액 + 매도 대금 (원화, 0 미만이면 0). 문서를 복사해서 고친 결과를 돌려준다.
export function applyTrades(doc, trades, { fx } = {}) {
  const next = JSON.parse(JSON.stringify(doc));
  const budget = Math.max(0, +next.monthly || 0) + Math.max(0, +next.carry || 0);
  let spent = 0, proceeds = 0;
  const rows = [];
  for (const t of trades || []) {
    const qty = +t.qty, price = +t.price;
    if (!(qty > 0) || !(price >= 0)) continue;
    const a = (next.assets || []).find(x => keyOf(x) === String(t.ticker || '').trim().toUpperCase());
    if (!a) continue;
    const usd = isUSD(a), rate = usd ? (+fx || 0) : 1;
    if (usd && !(rate > 0)) throw new Error('환율이 없어 달러 자산 체결을 반영할 수 없습니다.');
    const krw = qty * price * rate;
    const q0 = +a.qty || 0;
    if (t.side === 'sell') {
      a.qty = +Math.max(0, q0 - qty).toFixed(8);
      proceeds += krw;
    } else {
      const q1 = q0 + qty;
      a.avg = q1 > 0 ? +(((q0 * (+a.avg || 0)) + qty * price) / q1).toFixed(usd ? 4 : 2) : 0;
      a.qty = +q1.toFixed(8);
      spent += krw;
    }
    rows.push({ ticker: keyOf(a), side: t.side === 'sell' ? 'sell' : 'buy', qty, price, currency: usd ? 'USD' : 'KRW', fx: usd ? rate : null });
  }
  next.carry = Math.max(0, Math.round(budget - spent + proceeds));
  return { doc: next, rows, spent, proceeds, budget };
}

/* ---------- 월말 기록 ---------- */
export function snapshotOf(doc, prices) {
  const b = computeBoard(ensureGroups(JSON.parse(JSON.stringify(doc))), prices);
  return {
    total: b.T,
    withExcluded: b.T + b.exVal,
    fx: b.fx,
    groups: b.groupRows.map(g => ({ id: g.id, name: g.name, weight: +g.cur.toFixed(4), target: +g.tgt.toFixed(4), value: Math.round(b.T * g.cur / 100) })),
    assets: b.A.map((a, i) => ({ ticker: keyOf(a), name: a.name, value: Math.round(b.vals[i]), weight: +b.cur[i].toFixed(4) })),
  };
}

/* ---------- 가격 날짜 ---------- */
// 두 날짜(YYYY-MM-DD) 사이의 평일 수(시작일 다음 날부터 끝 날까지). 공휴일은 따로 빼지 않는다.
export function businessDaysBetween(fromIso, toIso) {
  const d = new Date(fromIso + 'T00:00:00Z'), end = new Date(toIso + 'T00:00:00Z');
  if (!(d < end)) return 0;
  let n = 0;
  for (let guard = 0; d < end && guard < 4000; guard++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}
