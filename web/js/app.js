// 화면 그리기와 이벤트. 계산은 rebalance.js, 숫자 표기는 format.js, 검색은 search.js, 저장은 docsync.js가 맡는다.
// 구성과 문구는 시안(reference/rebalance-board.html)을 따른다.
import { createDocSync } from './docsync.js';
import * as api from './api.js';
import {
  keyOf, isUSD, quoteOf, fxOf, krwPrice, localPrice, ensureGroups, computeBoard, targetSum, STATUS_LABEL, floorTo,
} from './rebalance.js';
import { won, wonShort, signedWon, pct, spct, pp, esc, fmtQty, fmtLocal, unitWord, qtyText, capText, usd } from './format.js';
import { indexSymbols, search } from './search.js';

const $ = id => document.getElementById(id);

// 처음 열었는데 저장된 포트폴리오가 없으면 보여 주는 예시(요청서 6장 테스트 벡터 경우 1과 같은 값).
const EXAMPLE = {
  example: true, monthly: 1000000, carry: 0, band: 5,
  assets: [
    { name: 'TIGER 미국S&P500', ticker: '360750', market: 'KR', qty: 520, avg: 19850, target: 35, unit: 1 },
    { name: 'KODEX 200', ticker: '069500', market: 'KR', qty: 180, avg: 36400, target: 15, unit: 1 },
    { name: 'QQQ', ticker: 'QQQ', market: 'US', qty: 9, avg: 498.2, target: 20, unit: 1 },
    { name: 'SCHD', ticker: 'SCHD', market: 'US', qty: 95, avg: 26.9, target: 10, unit: 1 },
    { name: 'KODEX 미국채10년선물', ticker: '308620', market: 'KR', qty: 210, avg: 12100, target: 10, unit: 1 },
    { name: '비트코인', ticker: 'KRW-BTC', market: 'CRYPTO', qty: 0.031, avg: 118000000, target: 10, unit: 0.0001 },
  ],
};
const EXAMPLE_PRICES = {
  asOf: null, example: true, fx: 1385,
  quotes: {
    '360750': { close: 23150, date: '2026-01-02' }, '069500': { close: 41200, date: '2026-01-02' },
    QQQ: { close: 612.4, date: '2026-01-02' }, SCHD: { close: 27.8, date: '2026-01-02' },
    '308620': { close: 11850, date: '2026-01-02' }, 'KRW-BTC': { close: 152000000, date: '2026-01-02' },
  },
};

const MARKETS = { KR: '국내상장', US: '해외상장', GOLD: '금현물', CRYPTO: '코인', CASH: '현금·예금' };
const TYPE_MARKET = { KS: 'KR', KE: 'KR', US: 'US', UE: 'US', GD: 'GOLD', CR: 'CRYPTO' };
const CLASSES = { KS: ['국내주식', 'var(--k1)'], GS: ['해외주식', 'var(--k2)'], BD: ['채권', 'var(--k3)'], CM: ['금·원자재', 'var(--k4)'], RE: ['리츠·부동산', 'var(--k5)'], CA: ['현금성', 'var(--k6)'], CR: ['가상자산', 'var(--k7)'] };
const LISTING = { KS: '국내상장 주식', KE: '국내상장 ETF', US: '미국상장 주식', UE: '미국상장 ETF', GD: 'KRX 현물', CR: '업비트', CS: '현금·예금' };
const ACCOUNTS = ['일반', 'ISA', '연금저축', 'IRP', '업비트', '기타'];
const GCOLORS = ['var(--k1)', 'var(--k2)', 'var(--k3)', 'var(--k4)', 'var(--k5)', 'var(--k7)', 'var(--k6)'];

let SYM = [], SYM_BY_CODE = new Map();
let realPrices = { quotes: {} };
let state = null; // 포트폴리오 문서(sync.doc와 같은 객체)

const prices = () => (state?.example ? EXAMPLE_PRICES : realPrices);
const acct = a => a.account && a.account !== '일반' ? ' · ' + esc(a.account) : '';
function typeOf(a) { const r = SYM_BY_CODE.get(keyOf(a)); return r ? r[2] : ({ KR: 'KS', US: 'US', GOLD: 'GD', CRYPTO: 'CR', CASH: 'CS' })[a.market] || 'KS'; }
function autoClass(a) { const r = SYM_BY_CODE.get(keyOf(a)); return r && r[6] ? r[6] : ({ KR: 'KS', US: 'GS', GOLD: 'CM', CRYPTO: 'CR', CASH: 'CA' })[a.market] || 'KS'; }
const clsOf = a => CLASSES[a.cls] ? a.cls : autoClass(a);
const clsChip = c => `<span class="type k" style="--c:${CLASSES[c][1]}">${CLASSES[c][0]}</span>`;
const md = iso => iso ? String(iso).slice(5).replace('-', '/') : '';
function kstTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/* ---------- 저장 ---------- */
const sync = createDocSync({
  render(doc, opts) { applyPortfolio(doc, opts && opts.force); },
  status(text) { $('saveState').textContent = text; },
  needToken() { $('tokenForm').hidden = false; $('tokenIn').focus(); },
});
function edited() { state.example = false; sync.edit(() => {}); }

/* ---------- 대시보드 ---------- */
function barRows(items, band) {
  const maxScale = Math.max(10, ...items.map(x => Math.max(x.cur, (x.tgt ?? 0) + band))) * 1.08;
  const sc = x => Math.min(100, Math.max(0, x / maxScale * 100));
  return items.map(it => {
    if (it.tgt == null) return `<div class="bar-row">
      <div class="bar-name" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="track" role="img" aria-label="${esc(it.name)} 현재 ${pct(it.cur)}"><div class="fill" style="width:${sc(it.cur)}%;opacity:.55"></div></div>
      <div class="bar-meta">${pct(it.cur)}<span class="d">${esc(it.note || '')}</span></div></div>`;
    const d = it.cur - it.tgt, ad = Math.abs(d);
    const cls = ad > band ? 'far' : ad > band / 2 ? 'over' : '';
    const dcls = ad > band ? 'big' : d > 0 ? 'pos' : 'neg';
    return `<div class="bar-row">
      <div class="bar-name" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="track" role="img" aria-label="${esc(it.name)} 현재 ${pct(it.cur)}, 목표 ${pct(it.tgt)}">
        <div class="band" style="left:${sc(it.tgt - band)}%;width:${sc(it.tgt + band) - sc(it.tgt - band)}%"></div>
        <div class="fill ${cls}" style="width:${sc(it.cur)}%"></div>
        <div class="tick" style="left:calc(${sc(it.tgt)}% - 1px)"></div>
      </div>
      <div class="bar-meta">${pct(it.cur)} / ${pct(it.tgt)}<span class="d ${dcls}">${pp(d)}</span></div>
    </div>`;
  }).join('');
}
const side = (a, s) => a.market === 'CASH' ? (s > 0 ? '입금' : '출금') : (s > 0 ? '매수' : '매도');

let lastBoard = null;
function renderPriceLine() {
  const P = prices(), fx = fxOf(P);
  const parts = [];
  if (P.example) parts.push('<span class="example">예시 가격</span>');
  else if (P.asOf) parts.push(`<span>수집 <b>${esc(kstTime(P.asOf))}</b></span>`);
  else parts.push('<span>가격 정보가 아직 없습니다</span>');
  if (fx) parts.push(`<span>환율 <b>${fx.toLocaleString('ko-KR')}</b>원${P.fxDate ? ' · ' + esc(md(P.fxDate)) : ''}</span>`);
  if (!P.example) parts.push('<button type="button" id="refreshBtn">가격 새로고침</button>');
  $('priceLine').innerHTML = parts.join('');
}

function renderBoard() {
  if (!state) return;
  const P = prices(), b = computeBoard(state, P);
  lastBoard = b;
  $('exampleTag').hidden = !state.example;
  renderPriceLine();

  const warns = [];
  if (b.missing.length) warns.push(`가격을 찾지 못한 자산은 평균단가로 계산했습니다: ${b.missing.map(a => esc(a.name || a.ticker || '이름 없음')).join(', ')}.`);
  if (b.stale.length) warns.push(`종가가 3영업일 넘게 갱신되지 않았습니다: ${b.stale.map(a => `${esc(a.name)}(${esc(md(quoteOf(P, a).date))})`).join(', ')}. 가격 새로고침을 눌러 보고, 계속되면 종목코드를 확인해 주세요.`);
  if (b.needFx) warns.push('환율 정보가 없어 달러 자산 평가액을 계산할 수 없습니다. 가격 새로고침을 눌러 주세요.');
  if (b.loose.length) warns.push(`그룹에 넣지 않은 종목은 목표 비중 0%로 계산됩니다: ${b.loose.map(u => esc(u.label)).join(', ')}. 포트폴리오 탭에서 그룹을 지정해 주세요.`);
  $('priceWarn').hidden = !warns.length; $('priceWarn').innerHTML = warns.join('<br>');

  const { T, TC, pl, exVal, band, units, uDrift, mdIdx } = b;
  $('sTotal').textContent = wonShort(T);
  $('sPL').innerHTML = (TC ? `<span class="${pl >= 0 ? 'up' : 'down'}">${signedWon(pl)} (${spct(pl / TC * 100)})</span>` : '') + (exVal ? `<br>제외 자산 포함 ${wonShort(T + exVal)}` : '');
  $('sDrift').textContent = b.md.toFixed(1) + '%p';
  $('sDriftSub').textContent = units.length ? (units[mdIdx].label + ' ' + pp(uDrift[mdIdx])) : '';
  $('sStatus').innerHTML = `<span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span>`;
  $('sStatusSub').textContent = '허용 밴드 ±' + band + '%p 기준';
  $('sMonths').textContent = b.months.kind === 'months' ? (b.months.months >= 120 ? '10년+' : b.months.months + '개월') : b.months.kind === 'na' ? '해당 없음' : '적립금 없음';

  $('classBars').innerHTML = barRows(b.groupRows, band) || '<p class="hint">그룹 추가를 눌러 첫 그룹을 만드세요.</p>';
  $('bars').innerHTML = barRows(b.A.map((a, i) => {
    const u = units[b.unitIndexOf(i)];
    return u.lead ? { name: a.name, cur: b.cur[i], tgt: null, note: u.label + ' 합산' } : { name: a.name, cur: b.cur[i], tgt: u.w * 100 };
  }), band) || '<p class="hint">보유 자산 탭에서 종목을 추가하면 비중이 표시됩니다.</p>';

  // 보유 현황
  $('tblHold').innerHTML = `<thead><tr><th>자산</th><th>현재가</th><th>평균단가</th><th>평가액</th><th>평가손익</th><th>수익률</th></tr></thead><tbody>` +
    b.A.map((a, i) => {
      const c = b.cost[i], p = c ? (b.vals[i] - c) : 0, r = c ? p / c * 100 : 0, cl = p >= 0 ? 'up' : 'down', cash = a.market === 'CASH', q = quoteOf(P, a);
      return `<tr><td>${esc(a.name)}<small>${cash ? '현금·예금 ' + qtyText(+a.qty || 0, a) : fmtQty(+a.qty || 0, +a.unit || 1) + unitWord(a)}${acct(a)}</small></td>
        <td>${cash ? (isUSD(a) && b.fx ? '$1=' + won(b.fx) : '–') : q ? fmtLocal(q.close, a) + `<small>${esc(md(q.date))}</small>` : '<span class="d pos">없음</span>'}</td><td>${cash ? '–' : fmtLocal(+a.avg || 0, a)}</td>
        <td>${wonShort(b.vals[i])}</td><td class="${cl}">${cash ? '–' : signedWon(p)}</td><td class="${cl}">${cash ? '–' : spct(r)}</td></tr>`;
    }).join('') +
    b.EXA.map(a => `<tr><td>${esc(a.name)}<small>리밸런싱 제외</small></td><td>–</td><td>–</td><td>${wonShort((+a.qty || 0) * krwPrice(P, a))}</td><td>–</td><td>–</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>투자자산 합계</td><td></td><td></td><td>${wonShort(T)}</td><td class="${pl >= 0 ? 'up' : 'down'}">${signedWon(pl)}</td><td class="${pl >= 0 ? 'up' : 'down'}">${TC ? spct(pl / TC * 100) : '–'}</td></tr></tfoot>`;

  // 이번 달 적립 배분
  const { plan, UA, uw, budget, carry, C, after, T2 } = b;
  $('monthlyHint').textContent = `예산 ${wonShort(budget)}` + (carry ? ` (적립 ${wonShort(C)} + 이월 ${wonShort(carry)})` : '') + ' · 매도 없이 부족한 쪽부터 채웁니다';
  const sub = (u, a) => `${u.g ? esc(u.g.name) : '미분류'}${acct(a)}`;
  $('tblMonthly').innerHTML = `<thead><tr><th>살 종목</th><th>배정액</th><th>매수 수량</th><th>실제 매수액</th><th>매수 후 비중</th><th>목표</th></tr></thead><tbody>` +
    units.map((u, i) => {
      const a = UA[i];
      return `<tr><td>${esc(a.name)}<small>${sub(u, a)}${a.market === 'CASH' ? (isUSD(a) ? ' · $1 ' + won(krwPrice(P, a)) : '') : ' · 1' + unitWord(a) + ' ' + won(krwPrice(P, a))}</small></td><td>${plan.raw[i] >= 1 ? won(plan.raw[i]) : '–'}</td>
      <td>${plan.q[i] > 0 ? `<span class="act buy">${side(a, 1)}</span> ${a.market === 'CASH' ? qtyText(plan.q[i], a) : fmtQty(plan.q[i], +a.unit || 1)}` : plan.blocked[i] ? '<span class="act hold">이번 달 보류</span>' : '<span class="act hold">유지</span>'}</td>
      <td>${plan.amt[i] > 0 ? won(plan.amt[i]) : '–'}</td><td>${T2 ? pct(after[i] / T2 * 100) : '–'}</td><td>${pct(uw[i] * 100)}</td></tr>`;
    }).join('') +
    `</tbody><tfoot><tr><td>합계</td><td>${won(budget)}</td><td></td><td>${won(plan.spent)}</td><td></td><td></td></tr></tfoot>`;
  const blockedNames = units.filter((u, i) => plan.blocked[i]).map(u => esc(b.A[u.buy].name));
  $('monthlyNote').innerHTML = budget > 0
    ? `매수 후 최대 이탈은 <b>${b.md.toFixed(1)}%p → ${b.md2.toFixed(1)}%p</b>입니다. 남는 현금 <b>${won(budget - plan.spent)}</b>은 다음 달 이월 현금으로 넘어갑니다.` +
      (blockedNames.length ? `<br>${blockedNames.join(', ')}은(는) 배정액이 매매 단위 가격보다 작아 이번 달은 사지 않습니다. 부족분이 쌓이면 다음 달에 우선 배정됩니다.` : '')
    : '포트폴리오 탭에서 월 적립금을 입력하면 이번 달 매수안을 계산합니다.';

  // 1월 정기 리밸런싱
  const { act, sells, buys, usGain, rest } = b.annual;
  $('tblAnnual').innerHTML = `<thead><tr><th>자산</th><th>현재</th><th>매매</th><th>금액</th></tr></thead><tbody>` +
    b.A.map((a, i) => {
      const x = act[i], u = units[b.unitIndexOf(i)];
      const tag = !x ? '<span class="act hold">유지</span>' : `<span class="act ${x.s < 0 ? 'sell' : 'buy'}">${side(a, x.s)}</span> ${a.market === 'CASH' ? qtyText(x.q, a) : fmtQty(x.q, +a.unit || 1)}`;
      return `<tr><td>${esc(a.name)}<small>${sub(u, a)}</small></td><td>${wonShort(b.vals[i])}</td><td>${tag}</td><td>${x ? (x.s < 0 ? '−' : '+') + won(x.amt) : '–'}</td></tr>`;
    }).join('') + `</tbody>`;
  const taxLine = usGain > 0
    ? ` 미국 상장 자산 매도로 생기는 양도차익은 약 <b>${won(usGain)}</b>입니다(현재 환율로 단순 환산). 연 250만 원 공제를 넘는 부분은 22% 과세 대상입니다.`
    : '';
  $('annualNote').innerHTML = `매도 <b>${won(sells)}</b> · 매수 <b>${won(buys)}</b> · 적립금·이월 현금 <b>${won(budget)}</b> 반영 후 남는 현금 <b>${won(rest)}</b>. 매도 대금이 들어온 뒤 매수하세요.${taxLine}`;
}

/* ---------- 보유 자산 편집 ---------- */
function priceCell(a) {
  const P = prices();
  if (a.market === 'CASH') {
    const fx = fxOf(P);
    return `<div class="price-ro"><span>현금·예금${isUSD(a) ? ' · 달러' : ''}</span><b>${isUSD(a) ? (fx ? '$1 = ' + won(fx) : '환율 없음') : '금액을 수량에 입력'}</b></div>`;
  }
  const q = quoteOf(P, a);
  if (q) return `<div class="price-ro${q.stale ? ' missing' : ''}"><span>전일 종가${q.date ? ' · ' + esc(md(q.date)) : ''}${q.stale ? ' · 오래됨' : ''}</span><b>${fmtLocal(q.close, a)}</b></div>`;
  return `<div class="price-ro missing"><span>전일 종가</span><b>${a.ticker ? (state.example || P.asOf ? '찾지 못함' : '새로고침 필요') : '종목코드 필요'}</b></div>`;
}
function totalLine(a) {
  const P = prices(), fx = fxOf(P);
  const v = (+a.qty || 0) * krwPrice(P, a);
  if (a.market === 'CASH') return `<span>평가액 <span class="num">${won(v)}</span></span>`;
  const c = (+a.qty || 0) * (+a.avg || 0) * (isUSD(a) ? (fx || 0) : 1), p = v - c;
  return `<span>평가액 <span class="num">${won(v)}</span></span><span class="${p >= 0 ? 'up' : 'down'} num">${signedWon(p)}${c ? ' (' + spct(p / c * 100) + ')' : ''}</span>`;
}
function unitOptions(a) {
  const opts = a.market === 'CASH' ? (isUSD(a) ? [0.01, 1] : [1]) : [1, 0.01, 0.0001];
  return opts.map(v => `<option value="${v}" ${+a.unit === v ? 'selected' : ''}>${v === 1 ? '1' + unitWord(a) : v}</option>`).join('');
}
function renderAssets() {
  const A = state.assets || [];
  $('assets').innerHTML = A.map((a, i) => {
    const cash = a.market === 'CASH';
    const codeFields = a.manual
      ? (cash
        ? `<div class="field f-cur"><label for="cu${i}">통화</label><select id="cu${i}" data-k="currency"><option value="KRW" ${!isUSD(a) ? 'selected' : ''}>원화</option><option value="USD" ${isUSD(a) ? 'selected' : ''}>USD</option></select></div>`
        : `<div class="field f-tk"><label for="k${i}">종목코드</label><input id="k${i}" data-k="ticker" value="${esc(a.ticker)}" autocapitalize="characters" spellcheck="false"></div>`)
        + `<div class="field f-mk"><label for="m${i}">시장</label><select id="m${i}" data-k="market">${Object.entries(MARKETS).map(([k, v]) => `<option value="${k}" ${a.market === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`
      : `<div class="code-ro f-tk">${LISTING[typeOf(a)] || '종목코드'}<span class="c">${esc(a.ticker)}</span></div><div class="code-ro f-mk">자산군<span>${clsChip(clsOf(a))}</span></div>`;
    return `
    <div class="asset" data-i="${i}">
      <div class="field f-name"><label for="n${i}">자산명</label><input id="n${i}" data-k="name" value="${esc(a.name)}"></div>
      ${codeFields}
      <div class="field f-ac"><label for="ac${i}">계좌</label><select id="ac${i}" data-k="account">${ACCOUNTS.map(v => `<option ${(a.account || '일반') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field f-unit"><label for="u${i}">매매 단위</label><select id="u${i}" data-k="unit">${unitOptions(a)}</select></div>
      <div class="field f-qty"><label for="q${i}">${cash ? (isUSD(a) ? '금액 ($)' : '금액 (원)') : `보유 수량 (${unitWord(a)})`}</label><input id="q${i}" class="num" data-k="qty" type="number" step="any" inputmode="decimal" value="${a.qty ?? 0}"></div>
      ${cash ? '<div class="f-avg"></div>' : `<div class="field f-avg"><label for="a${i}">평균단가 (${isUSD(a) ? '$' : '원'})</label><input id="a${i}" class="num" data-k="avg" type="number" step="any" inputmode="decimal" value="${a.avg ?? 0}"></div>`}
      ${priceCell(a)}
      <button class="del" type="button" data-del="${i}" aria-label="${esc(a.name)} 삭제">✕</button>
      <div class="asset-total">${totalLine(a)}</div>
      <label class="excl"><input type="checkbox" data-k="exclude" ${a.exclude ? 'checked' : ''}> 리밸런싱에서 제외 (전세보증금처럼 사고팔 수 없는 자산)</label>
    </div>`;
  }).join('') || '<p class="hint">아직 자산이 없습니다. 위에서 종목을 검색해 추가하세요.</p>';
}
function refreshAssetMeta() {
  document.querySelectorAll('.asset').forEach(el => {
    const a = state.assets[+el.dataset.i]; if (!a) return;
    el.querySelector('.price-ro').outerHTML = priceCell(a);
    el.querySelector('.asset-total').innerHTML = totalLine(a);
  });
}

/* ---------- 포트폴리오(그룹) ---------- */
const members = g => state.assets.map((a, i) => [a, i]).filter(([a]) => !a.exclude && a.group === g.id);
const groupOptions = sel => `<option value="">미분류</option>` + state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
function memRow(a, i, showInner) {
  return `<div class="mem">
    <div class="tgt-name"><b>${esc(a.name)}</b><span class="meta"><select class="cls-sel" data-move="${i}" aria-label="${esc(a.name)} 그룹 이동">${groupOptions(a.group)}</select><span class="sub-code">${esc(a.account || '일반')} · ${LISTING[typeOf(a)] || ''}</span></span></div>
    <div class="tgt-cur" data-cur="${i}"></div>
    ${showInner ? `<div class="tgt-in ratio"><input id="in${i}" class="num" data-inner="${i}" type="number" step="1" min="0" inputmode="decimal" value="${a.inner ?? 1}" aria-label="${esc(a.name)} 그룹 내 비율"></div>` : '<div></div>'}
  </div>`;
}
function renderTargets() {
  ensureGroups(state);
  const G = state.groups;
  const html = G.map((g, gi) => {
    const M = members(g), multi = M.length > 1, lead = g.mode === 'lead' && multi;
    const opts = sel => M.map(([a]) => `<option value="${esc(keyOf(a))}" ${keyOf(a) === String(sel || '').toUpperCase() ? 'selected' : ''}>${esc(a.name)} (${esc(a.account || '일반')})</option>`).join('');
    return `<div class="grp" data-g="${esc(g.id)}">
      <div class="grp-head">
        <i class="sw" style="background:${GCOLORS[gi % GCOLORS.length]}"></i>
        <input id="gn-${esc(g.id)}" class="gname" data-gk="name" value="${esc(g.name)}" aria-label="그룹 이름">
        <span class="tgt-cur" data-gcur="${esc(g.id)}"></span>
        <div class="tgt-in"><input id="gt-${esc(g.id)}" class="num" data-gk="target" type="number" step="0.5" min="0" max="100" inputmode="decimal" value="${g.target ?? 0}" aria-label="${esc(g.name)} 목표 비중"></div>
        <button class="del" type="button" data-gdel="${esc(g.id)}" aria-label="${esc(g.name)} 그룹 삭제">✕</button>
      </div>
      ${multi ? `<div class="grp-rule"><label>규칙 <select data-gk="mode"><option value="ratio" ${!lead ? 'selected' : ''}>비율대로 나눠 사기</option><option value="lead" ${lead ? 'selected' : ''}>대표 종목만 사기</option></select></label>
        ${lead ? `<label>매수 <select data-gk="lead">${opts(g.lead || keyOf(M[0][0]))}</select></label><label>먼저 매도 <select data-gk="sell">${opts(g.sell || g.lead || keyOf(M[0][0]))}</select></label>` : '<span>아래 비율에 못 미치는 종목부터 사고, 넘치는 종목부터 팝니다</span>'}</div>` : ''}
      ${M.map(([a, i]) => memRow(a, i, multi && !lead)).join('') || '<p class="hint">아직 종목이 없습니다. 다른 그룹이나 미분류의 종목을 이 그룹으로 옮기세요.</p>'}
    </div>`;
  }).join('');
  const loose = state.assets.map((a, i) => [a, i]).filter(([a]) => !a.exclude && !G.some(g => g.id === a.group));
  const ex = state.assets.filter(a => a.exclude);
  $('targets').innerHTML = (html
    + (loose.length ? `<div class="grp"><div class="grp-rule"><b>미분류</b><span>그룹에 넣어야 목표 비중이 적용됩니다</span></div>${loose.map(([a, i]) => memRow(a, i, false)).join('')}</div>` : '')
    + (ex.length ? `<p class="hint">리밸런싱 제외: ${ex.map(a => esc(a.name)).join(', ')}</p>` : ''))
    || '<p class="hint">그룹 추가를 눌러 첫 그룹을 만드세요.</p>';
  renderTargetMeta();
}
function renderTargetMeta() {
  const P = prices(), A = state.assets || [], G = state.groups || [];
  const vals = A.map(a => a.exclude ? 0 : (+a.qty || 0) * krwPrice(P, a)), T = vals.reduce((s, v) => s + v, 0);
  document.querySelectorAll('[data-cur]').forEach(el => { const i = +el.dataset.cur; el.textContent = T ? pct(vals[i] / T * 100) : '–'; });
  document.querySelectorAll('[data-gcur]').forEach(el => { const g = G.find(x => x.id === el.dataset.gcur); el.textContent = g && T ? pct(members(g).reduce((x, [, i]) => x + vals[i], 0) / T * 100) : '–'; });
  const parts = G.map((g, gi) => [g.name, members(g).length ? (+g.target || 0) : 0, GCOLORS[gi % GCOLORS.length]]);
  $('gaugeTrack').innerHTML = parts.map(([l, v, c]) => v > 0 ? `<i style="width:${Math.min(100, v)}%;background:${c}" title="${esc(l)} ${v}%"></i>` : '').join('');
  $('groups').innerHTML = parts.filter(p => p[1] > 0).map(([l, v, c]) => `<span><i class="sw" style="background:${c}"></i>${esc(l)} <b>${+v.toFixed(1)}%</b></span>`).join('');
  const s = targetSum(state);
  $('tgtSum').innerHTML = Math.abs(s - 100) > 0.01
    ? `<span class="warnline">목표 비중 합계 ${s.toFixed(1)}% · 100%로 맞춰 주세요 (지금은 비율로 환산 중)</span>` : '목표 비중 합계 100%';
}
function fillSettings() { $('monthly').value = state.monthly ?? ''; $('carry').value = state.carry ?? 0; $('bandIn').value = state.band ?? ''; }

function changed(structural) {
  if (structural) { renderAssets(); renderTargets(); } else { refreshAssetMeta(); renderTargetMeta(); }
  renderBoard(); edited();
}

$('assets').addEventListener('input', e => {
  const row = e.target.closest('.asset'); const k = e.target.dataset.k; if (!row || !k) return;
  const a = state.assets[+row.dataset.i];
  a[k] = k === 'exclude' ? e.target.checked : ['name', 'ticker', 'market', 'account', 'currency'].includes(k) ? e.target.value : +e.target.value;
  if (k === 'ticker') a.ticker = e.target.value.trim();
  if (k === 'market' && a.market === 'CASH') { a.currency = a.currency || 'KRW'; a.avg = 1; a.unit = 1; if (!a.ticker) a.ticker = newCashTicker(); }
  if (k === 'currency') { a.unit = a.currency === 'USD' ? 0.01 : 1; a.avg = 1; }
  changed(['market', 'exclude', 'account', 'currency'].includes(k));
});
$('assets').addEventListener('click', e => {
  const i = e.target.dataset.del; if (i === undefined) return;
  state.assets.splice(+i, 1); changed(true);
});
$('monthly').addEventListener('input', e => { state.monthly = +e.target.value; renderBoard(); edited(); });
$('bandIn').addEventListener('input', e => { state.band = +e.target.value; renderBoard(); edited(); });
$('carry').addEventListener('input', e => { state.carry = +e.target.value; renderBoard(); edited(); });
$('targets').addEventListener('input', e => {
  const t = e.target, grp = t.closest('.grp');
  if (t.dataset.inner !== undefined) state.assets[+t.dataset.inner].inner = Math.max(0, +t.value || 0);
  else if (grp && (t.dataset.gk === 'name' || t.dataset.gk === 'target')) {
    const g = state.groups.find(x => x.id === grp.dataset.g); if (!g) return;
    if (t.dataset.gk === 'name') { g.name = t.value; document.querySelectorAll('#targets select[data-move] option').forEach(o => { if (o.value === g.id) o.textContent = g.name; }); }
    else g.target = Math.max(0, +t.value || 0);
  } else return;
  renderTargetMeta(); renderBoard(); edited();
});
$('targets').addEventListener('change', e => {
  const t = e.target, grp = t.closest('.grp');
  if (t.dataset.move !== undefined) { const a = state.assets[+t.dataset.move]; if (t.value) a.group = t.value; else delete a.group; }
  else if (grp && ['mode', 'lead', 'sell'].includes(t.dataset.gk)) {
    const g = state.groups.find(x => x.id === grp.dataset.g); if (!g) return;
    g[t.dataset.gk] = t.value;
    if (g.mode === 'lead' && !g.lead) { const M = members(g); if (M.length) g.lead = g.sell = keyOf(M[0][0]); }
  } else return;
  renderTargets(); renderBoard(); edited();
});
$('targets').addEventListener('click', e => {
  const id = e.target.dataset.gdel; if (id === undefined) return;
  state.groups = state.groups.filter(g => g.id !== id);
  state.assets.forEach(a => { if (a.group === id) delete a.group; });
  renderTargets(); renderBoard(); edited();
});
$('addGroup').addEventListener('click', () => {
  const id = 'g' + Date.now().toString(36);
  state.groups.push({ id, name: '새 그룹', target: 0, mode: 'ratio' });
  renderTargets(); renderBoard(); edited();
  const el = $('gn-' + id); if (el) { el.focus(); el.select(); }
});

/* ---------- 종목 검색 ---------- */
let filter = 'all';
function renderResults() {
  const q = $('q').value, list = search(SYM, q, filter), ul = $('results');
  if (!q.trim() && !list.length) { ul.hidden = true; ul.innerHTML = ''; return; }
  ul.hidden = false;
  if (!SYM.length) { ul.innerHTML = '<li><p class="hint" style="padding:10px 12px">종목 목록을 불러오는 중입니다.</p></li>'; return; }
  if (!list.length) { ul.innerHTML = `<li><p class="hint" style="padding:10px 12px">'${esc(q)}'에 맞는 종목이 없습니다. 이름을 줄여 보거나 직접 입력을 이용하세요.</p></li>`; return; }
  const held = new Set((state?.assets || []).map(keyOf));
  ul.innerHTML = list.map(r => `<li><button type="button" data-code="${esc(r[0])}">
    <span class="rn">${esc(r[1])}</span>
    <span class="rc">${LISTING[r[2]]} · ${esc(r[0])}${+r[3] ? ' · 시총 ' + capText(+r[3]) : ''}${r[4] && (r[2] === 'US' || r[2] === 'UE') ? ' · ' + esc(r[4].replace(/\|/g, ', ')) : ''}</span>
    <span class="rt">${held.has(String(r[0]).toUpperCase()) ? '<span class="have">보유 중</span> ' : ''}${clsChip(r[6] || 'KS')}</span>
  </button></li>`).join('');
}
let qTimer = null;
$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderResults, 120); });
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  filter = c.dataset.f;
  document.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === c));
  renderResults();
}));
function focusAsset(i, field) {
  const row = document.querySelector(`.asset[data-i="${i}"]`); if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1400);
  const el = $(field + i); if (el) { el.focus({ preventScroll: true }); el.select?.(); }
}
function startFromExample() {
  // 예시를 보고 있다가 첫 종목을 추가하면 예시를 지우고 내 포트폴리오로 시작한다.
  if (!state.example) return;
  state.assets = []; state.groups = []; state.example = false;
}
$('results').addEventListener('click', e => {
  const b = e.target.closest('button[data-code]'); if (!b) return;
  const r = SYM_BY_CODE.get(b.dataset.code.toUpperCase()); if (!r) return;
  startFromExample();
  const existing = state.assets.findIndex(a => keyOf(a) === String(r[0]).toUpperCase());
  $('q').value = ''; renderResults();
  if (existing >= 0) { focusAsset(existing, 'q'); return; }
  const market = TYPE_MARKET[r[2]];
  state.assets.push({ name: r[1].replace(' (1g)', ''), ticker: r[0], market, qty: 0, avg: 0, unit: market === 'CRYPTO' ? 0.0001 : 1 });
  changed(true);
  focusAsset(state.assets.length - 1, 'q');
  refreshSoon();
});
const newCashTicker = () => { let n = 1; const have = new Set(state.assets.map(keyOf)); while (have.has('CASH' + n)) n++; return 'CASH' + n; };
$('manualBtn').addEventListener('click', () => {
  startFromExample();
  state.assets.push({ name: $('q').value.trim() || '새 자산', ticker: '', market: 'KR', qty: 0, avg: 0, unit: 1, manual: true });
  $('q').value = ''; renderResults(); changed(true);
  focusAsset(state.assets.length - 1, 'k');
});
$('cashBtn').addEventListener('click', () => {
  startFromExample();
  state.assets.push({ name: '현금·예금', ticker: newCashTicker(), market: 'CASH', currency: 'KRW', qty: 0, avg: 1, unit: 1, manual: true });
  changed(true);
  focusAsset(state.assets.length - 1, 'q');
});

/* ---------- 가격 ---------- */
async function loadPrices() {
  try { realPrices = await api.getPrices(); if (!realPrices.quotes) realPrices.quotes = {}; }
  catch { /* 가격 없이도 평균단가로 그린다 */ }
  if (state) { renderBoard(); refreshAssetMeta(); renderTargetMeta(); }
}
async function refreshPrices() {
  const btn = $('refreshBtn'); if (btn) { btn.disabled = true; btn.textContent = '받는 중…'; }
  await sync.settle();
  const r = await api.refreshPrices().catch(() => ({ ok: false, error: '서버에 연결하지 못했습니다.' }));
  if (r.unauthorized) { $('saveState').textContent = '가격을 새로 받으려면 편집 암호를 입력하세요.'; $('tokenForm').hidden = false; $('tokenIn').focus(); }
  else if (!r.ok) $('saveState').textContent = '가격을 받지 못했습니다: ' + r.error;
  else {
    realPrices = r.prices;
    const f = r.result.failed || [];
    $('saveState').textContent = `가격 ${r.result.updated.length}건을 받았습니다.` + (f.length ? ` 받지 못한 종목: ${f.map(x => x.name).join(', ')}(직전 종가 유지).` : '') + (r.result.errors?.FX ? ' 환율을 받지 못했습니다.' : '');
  }
  renderBoard(); refreshAssetMeta(); renderTargetMeta();
}
// 새 종목을 넣으면 저장이 끝난 뒤 그 종목 가격을 바로 받아 둔다(편집 암호가 이미 있을 때만).
let refreshTimer = null;
function refreshSoon() {
  if (!api.getToken()) return;
  clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshPrices, 2500);
}
$('priceLine').addEventListener('click', e => { if (e.target.id === 'refreshBtn') refreshPrices(); });

/* ---------- 체결 반영 ---------- */
let tradeKind = null, tradeRows = [];
function planRows(kind) {
  const b = lastBoard, P = prices(); if (!b) return [];
  const rows = [];
  if (kind === 'monthly') {
    b.units.forEach((u, i) => { if (b.plan.q[i] > 0) { const a = b.UA[i]; rows.push({ ticker: keyOf(a), side: 'buy', qty: b.plan.q[i], price: localPrice(P, a) }); } });
  } else {
    b.A.forEach((a, i) => { const x = b.annual.act[i]; if (x) rows.push({ ticker: keyOf(a), side: x.s < 0 ? 'sell' : 'buy', qty: x.q, price: localPrice(P, a) }); });
    rows.sort((x, y) => (x.side === 'sell' ? 0 : 1) - (y.side === 'sell' ? 0 : 1));
  }
  return rows;
}
const assetBy = t => (state.assets || []).find(a => keyOf(a) === t);
function tradeTotals() {
  const fx = fxOf(prices()) || 0;
  let spent = 0, proceeds = 0;
  for (const r of tradeRows) {
    const a = assetBy(r.ticker); if (!a || !(+r.qty > 0)) continue;
    const krw = +r.qty * (+r.price || 0) * (isUSD(a) ? fx : 1);
    if (r.side === 'sell') proceeds += krw; else spent += krw;
  }
  const budget = Math.max(0, +state.monthly || 0) + Math.max(0, +state.carry || 0);
  return { spent, proceeds, budget, carry: Math.max(0, Math.round(budget - spent + proceeds)) };
}
function renderTradePanel() {
  document.querySelectorAll('.apply-slot').forEach(s => { if (s.dataset.slot !== tradeKind) s.innerHTML = ''; });
  document.querySelectorAll('[data-apply]').forEach(bn => { bn.closest('.apply-row').hidden = bn.dataset.apply === tradeKind; });
  if (!tradeKind) return;
  const slot = document.querySelector(`.apply-slot[data-slot="${tradeKind}"]`);
  const opt = sel => state.assets.filter(a => !a.exclude).map(a => `<option value="${esc(keyOf(a))}" ${keyOf(a) === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const t = tradeTotals();
  slot.innerHTML = `<div class="trade" role="region" aria-label="체결 반영 확인">
    <h3>${tradeKind === 'monthly' ? '이번 달 체결 확인' : '1월 리밸런싱 체결 확인'}</h3>
    <p class="hint">실제 체결 수량과 체결가로 고친 뒤 반영을 누르세요. 체결하지 않은 행은 ✕로 뺍니다. 미국 자산 체결가는 달러입니다.</p>
    <div class="trade-rows">${tradeRows.map((r, i) => {
      const a = assetBy(r.ticker) || { name: r.ticker, market: 'KR' };
      return `<div class="trow" data-t="${i}">
        <div class="tname"><b>${esc(a.name)}</b><small>${esc(r.ticker)}${acct(a)}</small></div>
        <div class="field f-side"><label for="ts${i}">구분</label><select id="ts${i}" data-tk="side"><option value="buy" ${r.side !== 'sell' ? 'selected' : ''}>${side(a, 1)}</option><option value="sell" ${r.side === 'sell' ? 'selected' : ''}>${side(a, -1)}</option></select></div>
        <div class="field f-tq"><label for="tq${i}">${a.market === 'CASH' ? '금액' : '수량'} (${unitWord(a)})</label><input id="tq${i}" class="num" data-tk="qty" type="number" step="any" inputmode="decimal" value="${+(+r.qty).toFixed(8)}"></div>
        <div class="field f-tp"><label for="tp${i}">체결가 (${isUSD(a) ? '$' : '원'})</label><input id="tp${i}" class="num" data-tk="price" type="number" step="any" inputmode="decimal" value="${a.market === 'CASH' ? 1 : +(+r.price).toFixed(4)}" ${a.market === 'CASH' ? 'readonly' : ''}></div>
        <button class="del" type="button" data-tdel="${i}" aria-label="${esc(a.name)} 행 빼기">✕</button>
      </div>`;
    }).join('') || '<p class="hint">반영할 행이 없습니다. 아래에서 종목을 골라 추가하세요.</p>'}</div>
    <div class="row"><select id="tAddSel" aria-label="추가할 종목" style="width:auto;max-width:100%">${opt('')}</select><button type="button" id="tAdd">행 추가</button></div>
    <div class="trade-sum" id="tradeSum">${tradeSumHtml(t)}</div>
    <p class="err" id="tradeErr" hidden></p>
    <div class="row"><button class="primary" type="button" id="tApply">반영</button><button type="button" id="tCancel">취소</button></div>
  </div>`;
}
const tradeSumHtml = t => `<span>매수 <b>${won(t.spent)}</b>${t.proceeds ? ` · 매도 <b>${won(t.proceeds)}</b>` : ''}</span><span>반영 후 이월 현금 <b>${won(t.carry)}</b></span>`;
function openTrade(kind) {
  if (state.example) { $('saveState').textContent = '예시 데이터에는 체결을 반영할 수 없습니다. 보유 자산 탭에서 내 종목을 추가해 주세요.'; return; }
  tradeKind = kind; tradeRows = planRows(kind);
  renderTradePanel();
  document.querySelector(`.apply-slot[data-slot="${kind}"] .trade`)?.scrollIntoView({ block: 'nearest' });
}
function closeTrade() { tradeKind = null; tradeRows = []; renderTradePanel(); }
document.querySelectorAll('[data-apply]').forEach(bn => bn.addEventListener('click', () => openTrade(bn.dataset.apply)));
$('board').addEventListener('input', e => {
  const row = e.target.closest('.trow'); const k = e.target.dataset.tk; if (!row || !k) return;
  tradeRows[+row.dataset.t][k] = e.target.value;
  $('tradeSum').innerHTML = tradeSumHtml(tradeTotals());
});
$('board').addEventListener('change', e => {
  if (e.target.dataset.tk === 'side') renderTradePanel();
});
$('board').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.tdel !== undefined) { tradeRows.splice(+t.dataset.tdel, 1); renderTradePanel(); return; }
  if (t.id === 'tAdd') {
    const tk = $('tAddSel').value, a = assetBy(tk); if (!a) return;
    tradeRows.push({ ticker: tk, side: 'buy', qty: a.market === 'CASH' ? 0 : floorTo(1, +a.unit || 1), price: localPrice(prices(), a) });
    renderTradePanel(); return;
  }
  if (t.id === 'tCancel') { closeTrade(); return; }
  if (t.id === 'tApply') { await submitTrades(); return; }
  if (t.id === 'undoBtn') { await undo(); }
});
let undoInfo = null, undoTimer = null;
async function submitTrades() {
  const err = $('tradeErr'), btn = $('tApply');
  const rows = tradeRows.filter(r => +r.qty > 0).map(r => ({ ticker: r.ticker, side: r.side, qty: +r.qty, price: assetBy(r.ticker)?.market === 'CASH' ? 1 : +r.price }));
  if (!rows.length) { err.hidden = false; err.textContent = '수량이 0보다 큰 행이 없습니다.'; return; }
  btn.disabled = true;
  await sync.settle();
  const kind = tradeKind;
  const r = await api.applyTrades({ version: sync.version, kind, fx: fxOf(prices()), trades: rows }).catch(() => ({ ok: false, error: '서버에 연결하지 못했습니다.' }));
  btn.disabled = false;
  if (r.unauthorized) { err.hidden = false; err.textContent = '반영하려면 아래에 편집 암호를 입력한 뒤 다시 반영을 누르세요.'; $('tokenForm').hidden = false; $('tokenIn').focus(); return; }
  if (r.conflict) { sync.replace(r.doc, r.version); $('saveState').textContent = '다른 기기에서 수정돼 새로 불러왔습니다. 매매안을 확인하고 다시 체결 반영을 눌러 주세요.'; return; }
  if (!r.ok) { err.hidden = false; err.textContent = r.error; return; }
  closeTrade();
  sync.replace(r.doc, r.version);
  $('saveState').textContent = '체결을 반영했습니다';
  showUndo(kind, r.batch, r.spent, r.proceeds);
}
function showUndo(kind, batch, spent, proceeds) {
  undoInfo = { kind, batch, until: Date.now() + 30000 };
  clearInterval(undoTimer);
  const slot = document.querySelector(`.apply-slot[data-slot="${kind}"]`);
  const draw = () => {
    const left = Math.ceil((undoInfo.until - Date.now()) / 1000);
    if (left <= 0) { clearInterval(undoTimer); slot.innerHTML = ''; undoInfo = null; return; }
    slot.innerHTML = `<div class="callout undo"><span>보유 수량·평균단가와 이월 현금을 고쳤습니다(매수 <b>${won(spent)}</b>${proceeds ? `, 매도 <b>${won(proceeds)}</b>` : ''}).</span><button class="linkbtn" type="button" id="undoBtn">되돌리기 (${left}초)</button></div>`;
  };
  draw(); undoTimer = setInterval(draw, 1000);
}
async function undo() {
  if (!undoInfo) return;
  const { kind, batch } = undoInfo;
  clearInterval(undoTimer); undoInfo = null;
  const slot = document.querySelector(`.apply-slot[data-slot="${kind}"]`);
  await sync.settle();
  const r = await api.undoTrades(batch).catch(() => ({ ok: false, error: '서버에 연결하지 못했습니다.' }));
  if (r.ok) { sync.replace(r.doc, r.version); slot.innerHTML = ''; $('saveState').textContent = '반영을 되돌렸습니다'; return; }
  if (r.conflict && r.doc) sync.replace(r.doc, r.version);
  slot.innerHTML = `<p class="err">${esc(r.unauthorized ? '편집 암호가 필요합니다.' : r.detail || r.error || '되돌리지 못했습니다.')}</p>`;
}

/* ---------- 탭 ---------- */
const TABS = ['board', 'portfolio', 'holdings'];
function showTab(name) {
  const t = TABS.includes(name) ? name : 'board';
  TABS.forEach(k => { $(k).hidden = k !== t; $('tab-' + k).setAttribute('aria-selected', k === t); });
}
TABS.forEach(k => $('tab-' + k).addEventListener('click', () => { location.hash = k; showTab(k); }));
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

/* ---------- 편집 암호 ---------- */
$('tokenForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('tokenIn').value.trim(); $('tokenIn').value = '';
  $('tokenForm').hidden = true;
  sync.setToken(t);
});

/* ---------- 시작 ---------- */
function applyPortfolio(doc, force) {
  // 저장된 포트폴리오가 없으면 예시를 보여 준다(고치면 그때부터 내 포트폴리오로 저장된다).
  if (!Array.isArray(doc.assets) || (!doc.assets.length && !doc.groups && !('monthly' in doc))) {
    Object.assign(doc, JSON.parse(JSON.stringify(EXAMPLE)));
  }
  state = doc;
  ensureGroups(state);
  if (tradeKind) closeTrade();
  const editingH = !force && document.activeElement && $('holdings').contains(document.activeElement);
  const editingP = !force && document.activeElement && $('portfolio').contains(document.activeElement);
  if (!editingH) renderAssets(); else refreshAssetMeta();
  if (!editingP) { renderTargets(); fillSettings(); } else renderTargetMeta();
  renderBoard();
}

sync.load();
loadPrices();
fetch('symbols.json').then(r => r.json()).then(rows => { SYM = rows; SYM_BY_CODE = indexSymbols(SYM); if ($('q').value) renderResults(); if (state) { renderAssets(); renderTargets(); } }).catch(() => { SYM = []; });
