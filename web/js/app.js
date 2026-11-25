// 화면 그리기와 이벤트. 계산은 rebalance.js, 숫자 표기는 format.js, 검색은 search.js, 저장은 docsync.js가 맡는다.
// 구성과 문구는 시안(reference/rebalance-board.html)을 따른다.
import { createDocSync } from './docsync.js';
import * as api from './api.js';
import {
  keyOf, isUSD, quoteOf, fxOf, krwPrice, localPrice, ensureGroups, computeBoard, targetSum, STATUS_LABEL, floorTo,
} from './rebalance.js';
import { won, wonShort, signedWon, pct, spct, pp, esc, fmtQty, fmtLocal, unitWord, qtyText, capText, usd } from './format.js';
import { indexSymbols, search } from './search.js';
import { donutSegments, draftFromPlan, stepQty, qtyFromAmount, draftTrades, byAmount, annualOpenByDefault } from './draft.js';

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
let statusTimer = null;
const sync = createDocSync({
  render(doc, opts) { applyPortfolio(doc, opts && opts.force); },
  status(text) {
    // '저장됨'은 3초 뒤 지운다(대시보드를 한 화면에 두기 위해). 오류·안내 문구는 남긴다.
    $('saveState').textContent = text; clearTimeout(statusTimer);
    if (text === '저장됨') statusTimer = setTimeout(() => { if ($('saveState').textContent === '저장됨') $('saveState').textContent = ''; }, 3000);
  },
  needToken({ firstTime, minLength, hubLogin } = {}) {
    if (hubLogin) { // 허브 로그인: 로그인한 뒤 이 화면으로 돌아온다
      $('hubLogin').href = hubLogin + '&return=' + encodeURIComponent(location.href);
      $('hubLoginBox').hidden = false; $('tokenForm').hidden = true;
      return;
    }
    $('tokenLabel').textContent = firstTime ? '편집 암호 정하기' : '편집 암호';
    $('tokenIn').autocomplete = firstTime ? 'new-password' : 'current-password';
    $('tokenIn').minLength = firstTime ? minLength : 0;
    $('tokenForm').hidden = false; $('tokenIn').focus();
  },
});
function edited() { state.example = false; sync.edit(() => {}); }

/* ---------- 대시보드 ---------- */
const side = (a, s) => a.market === 'CASH' ? (s > 0 ? '입금' : '출금') : (s > 0 ? '매수' : '매도');

let lastBoard = null;
function renderPriceLine() {
  const P = prices(), fx = fxOf(P);
  const parts = [];
  if (P.example) parts.push('<span class="example">예시 가격</span>');
  else if (P.asOf) parts.push(`<span>수집 <b>${esc(kstTime(P.asOf))}</b></span>`);
  else parts.push('<span>가격 정보가 아직 없습니다</span>');
  if (fx) parts.push(`<span>환율 <b>${fx.toLocaleString('ko-KR')}</b>원${P.fxDate ? ' · ' + esc(md(P.fxDate)) : ''}</span>`);
  if (!P.example) parts.push('<button type="button" id="refreshBtn" aria-label="가격 새로고침">↻ 새로고침</button>');
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
  $('sPL').innerHTML = (TC ? `<span class="${pl >= 0 ? 'up' : 'down'}">${pl < 0 ? '' : '+'}${wonShort(pl)} (${spct(pl / TC * 100)})</span>` : '') + (exVal ? `${TC ? ' · ' : ''}제외 포함 ${wonShort(T + exVal)}` : '');
  $('sStatus').innerHTML = `<span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span>`;
  const far = b.groupRows.filter(r => r.id !== null && Math.abs(r.cur - r.tgt) > band).length;
  const mo = b.months.kind === 'months' ? ` · 적립만으로 ${b.months.months >= 120 ? '10년+' : b.months.months + '개월'}` : '';
  $('sStatusSub').innerHTML = (far ? `${far}개 그룹 밴드 밖` : `모두 밴드 ±${band}%p 안`) + mo;
  $('planHint').textContent = `월 ${wonShort(b.C)} · 밴드 ±${band}%p${b.carry ? ' · 이월 ' + wonShort(b.carry) : ''}`;
  renderGroupMix(b);
  renderBuys(b);
  renderAnnual(b);
}

// 그룹 비중: 도넛(안쪽 현재, 바깥 목표) + 그룹별 한 줄
function renderGroupMix(b) {
  const rows = b.groupRows, band = b.band;
  if (!rows.length) { $('groupMix').innerHTML = '<p class="hint">포트폴리오 탭에서 그룹을 만들면 비중이 표시됩니다.</p>'; return; }
  const colorOf = r => { const gi = (state.groups || []).findIndex(g => g.id === r.id); return gi < 0 ? 'var(--k6)' : GCOLORS[gi % GCOLORS.length]; };
  const ring = (vals, r, w, op) => donutSegments(vals).map((s, k) => s.len > 0
    ? `<circle r="${r}" cx="50" cy="50" pathLength="100" fill="none" stroke="${colorOf(rows[k])}" stroke-width="${w}" stroke-opacity="${op}" stroke-dasharray="${s.len} ${100 - s.len}" stroke-dashoffset="${-s.start}"/>` : '').join('');
  const svg = `<svg class="donut" viewBox="0 0 100 100" role="img" aria-label="그룹 비중 도넛(안쪽 현재, 바깥 목표): ${rows.map(r => `${esc(r.name)} 현재 ${pct(r.cur)} 목표 ${pct(r.tgt)}`).join(', ')}">
    <g transform="rotate(-90 50 50)">${ring(rows.map(r => r.tgt), 45, 5, .45)}${ring(rows.map(r => r.cur), 32, 16, 1)}</g>
    <text x="50" y="47" text-anchor="middle" class="dn-v">${b.md.toFixed(1)}%p</text>
    <text x="50" y="59" text-anchor="middle" class="dn-l">최대 이탈</text></svg>`;
  const list = rows.map(r => {
    const d = r.cur - r.tgt, ad = Math.abs(d), loose = r.id === null;
    const dcls = loose ? 'pos' : ad > band ? 'big' : ad > band / 2 ? 'pos' : 'ok';
    return `<li><i class="sw" style="background:${colorOf(r)}"></i><span class="mx-n">${esc(r.name)}</span>
      <span class="mx-v num"><span class="d ${dcls}">${pct(r.cur)}</span><small> / ${pct(r.tgt)}</small></span><span class="mx-d num d ${dcls}">${pp(d)}</span></li>`;
  }).join('');
  $('groupMix').innerHTML = `<figure class="dn-fig" title="안쪽 현재 · 바깥 목표">${svg}</figure><ul class="mx-list"><li class="mx-h"><span></span><span>그룹</span><span>현재 / 목표</span><span>차이</span></li>${list}</ul>`;
}

// 이번 달 살 것: 살 종목만 카드로. 체크·수량 조절 후 한 번에 반영한다.
let draft = [], draftBusy = false;
const assetBy = t => (state.assets || []).find(a => keyOf(a) === t);
function renderBuys(b) {
  const P = prices(), fx = fxOf(P) || 0;
  const { plan, units, UA, budget, carry, C } = b;
  $('monthlyHint').textContent = '';
  if (!(budget > 0)) {
    $('buyList').innerHTML = '<p class="hint">포트폴리오 탭에서 월 적립금을 입력하면 이번 달 살 종목을 계산합니다.</p>';
    $('holdBox').hidden = true; $('buyFoot').innerHTML = ''; $('buyLines').innerHTML = ''; $('buyMore').innerHTML = ''; return;
  }
  draft = draftFromPlan(b, P, draft);
  const unitOf = t => units.find((u, i) => keyOf(UA[i]) === t);
  $('buyList').innerHTML = draft.map((r, k) => {
    const a = assetBy(r.ticker); if (!a) return '';
    const u = unitOf(r.ticker), amtMode = byAmount(a), cash = a.market === 'CASH';
    const krw = (+r.qty || 0) * (cash ? 1 : +r.price || 0) * (isUSD(a) ? fx : 1);
    const changedQty = r.plan != null && +r.qty !== +r.plan;
    const ctrl = amtMode
      ? `<div class="stepper"><button type="button" data-bstep="-1" aria-label="1만 원 줄이기">−</button><input class="num" data-bamt type="number" step="10000" inputmode="numeric" value="${Math.round(krw)}" aria-label="${esc(a.name)} 매수 금액(원)"><button type="button" data-bstep="1" aria-label="1만 원 늘리기">+</button></div><span class="bq-u">원</span>`
      : `<div class="stepper"><button type="button" data-bstep="-1" aria-label="${esc(a.name)} 하나 줄이기">−</button><input class="num" data-bqty type="number" step="any" inputmode="decimal" value="${+(+r.qty).toFixed(8)}" aria-label="${esc(a.name)} 매수 ${cash ? '금액' : '수량'}"><button type="button" data-bstep="1" aria-label="${esc(a.name)} 하나 늘리기">+</button></div><span class="bq-u">${unitWord(a)}${changedQty ? ` <small>계획 ${fmtQty(r.plan, +a.unit || 1)}</small>` : ''}</span>`;
    const priceTxt = cash ? '' : amtMode ? ` · <span class="bq-q">${qtyText(+r.qty || 0, a)}</span>` : ` · 1${unitWord(a)} ${fmtLocal(+r.price || 0, a)}`;
    const priceEdit = cash ? '' : r.priceOpen
      ? `<label class="bp-edit">체결가 (${isUSD(a) ? '$' : '원'}) <input class="num" data-bprice type="number" step="any" inputmode="decimal" value="${+(+r.price).toFixed(4)}"></label>`
      : `<button class="linkbtn bp-open" type="button" data-bpopen>가격 다름</button>`;
    return `<div class="buy${r.on ? '' : ' off'}" data-b="${k}">
      <label class="buy-chk"><input type="checkbox" data-bon ${r.on ? 'checked' : ''} aria-label="${esc(a.name)} 샀음"></label>
      <div class="buy-name"><b>${esc(a.name)}</b><small>${u?.g ? esc(u.g.name) : r.extra ? '추가한 종목' : '미분류'}${acct(a)}${priceTxt}</small></div>
      <div class="buy-amt num">${won(krw)}</div>
      <div class="buy-ctrl">${ctrl}${r.priceOpen ? '' : priceEdit}</div>
      ${r.priceOpen ? `<div class="buy-price">${priceEdit}</div>` : ''}
    </div>`;
  }).join('') || '<p class="hint">이번 달은 살 종목이 없습니다.</p>';

  const holds = units.map((u, i) => [u, i]).filter(([, i]) => !(plan.q[i] > 0));
  const blocked = holds.filter(([, i]) => plan.blocked[i]).map(([, i]) => esc(UA[i].name));
  $('holdBox').hidden = !holds.length;
  $('holdSum').textContent = `이번 달 사지 않는 ${holds.length}종목`;
  $('holdLine').innerHTML = holds.map(([, i]) => esc(UA[i].name)).join(', ') + (blocked.length ? `<br>${blocked.join(', ')}은(는) 배정액이 1주 가격보다 작아 보류했습니다. 부족분이 쌓이면 다음 달에 우선 배정됩니다.` : '');
  renderBuyFoot();
}
let buyEditing = false;
function renderBuyFoot() {
  const opt = state.assets.filter(a => !a.exclude && !draft.some(r => r.ticker === keyOf(a))).map(a => `<option value="${esc(keyOf(a))}">${esc(a.name)}</option>`).join('');
  $('buyMore').innerHTML = `<p class="hint">계획대로 사면 최대 이탈 <b class="num">${lastBoard.md.toFixed(1)}%p → ${lastBoard.md2.toFixed(1)}%p</b></p>` +
    (opt ? `<details class="add-more"><summary class="linkbtn">다른 종목도 샀어요</summary><div class="row"><select id="buyAddSel" aria-label="추가할 종목">${opt}</select><button type="button" id="buyAdd">추가</button></div></details>` : '');
  $('buyFoot').innerHTML = `<p class="err" id="buyErr" hidden></p>
    <div class="row"><button class="primary" type="button" id="buyApply"></button><button type="button" id="buyEditBtn" aria-expanded="${buyEditing}" aria-controls="buyEdit">${buyEditing ? '고치기 닫기' : '수량 고치기'}</button></div>`;
  $('buyEdit').hidden = !buyEditing; $('buyLines').hidden = buyEditing;
  updateBuyFoot();
}
// 한눈에 보는 한 줄 목록(체크·수량을 고치면 함께 바뀐다)
function renderBuyLines() {
  const fx = fxOf(prices()) || 0;
  $('buyLines').innerHTML = draft.map(r => {
    const a = assetBy(r.ticker); if (!a) return '';
    const krw = (+r.qty || 0) * (a.market === 'CASH' ? 1 : +r.price || 0) * (isUSD(a) ? fx : 1);
    return `<li class="${r.on ? '' : 'off'}"><span class="bl-n">${esc(a.name)}</span><span class="bl-q num">${qtyText(+r.qty || 0, a)}</span><span class="bl-a num">${won(krw)}</span></li>`;
  }).join('') || '<li class="hint">이번 달은 살 종목이 없습니다.</li>';
}
// 합계와 버튼 글자만 바꾼다(버튼 자체는 그대로 두어 누르는 중인 클릭이 사라지지 않게)
function updateBuyFoot() {
  const b = lastBoard, fx = fxOf(prices()) || 0;
  const t = draftTrades(draft, state.assets, { fx, budget: b.budget }), n = t.trades.length, over = t.spent > b.budget + 1;
  $('monthlyHint').innerHTML = `예산 ${wonShort(b.budget)} · ${over ? `<span class="warnline">초과 ${won(t.spent - b.budget)}</span>` : `남는 현금 <b class="num">${won(t.carry)}</b>`}`;
  renderBuyLines();
  const bn = $('buyApply'); bn.disabled = !n || draftBusy; bn.textContent = draftBusy ? '반영하는 중…' : !n ? '반영할 종목 없음' : draft.some(r => r.touched) ? `${n}종목 반영` : `계획대로 ${n}종목 반영`;
}
// 카드 하나의 금액·수량 표시만 바꾼다
function updateCard(card, r) {
  const a = assetBy(r.ticker), fx = fxOf(prices()) || 0;
  const krw = (+r.qty || 0) * (a.market === 'CASH' ? 1 : +r.price || 0) * (isUSD(a) ? fx : 1);
  card.querySelector('.buy-amt').textContent = won(krw);
  card.classList.toggle('off', !r.on);
  const u = card.querySelector('.bq-u');
  const bq = card.querySelector('.bq-q'); if (bq) bq.textContent = qtyText(+r.qty || 0, a);
  if (u) u.innerHTML = byAmount(a) ? '원' : `${unitWord(a)}${r.plan != null && +r.qty !== +r.plan ? ` <small>계획 ${fmtQty(r.plan, +a.unit || 1)}</small>` : ''}`;
}

// 1월 정기 리밸런싱: 매매가 있는 종목만. 12·1월이거나 리밸런싱 필요 상태면 펼쳐 둔다.
let annualTouched = false;
function renderAnnual(b) {
  const { act, sells, buys, usGain, rest } = b.annual;
  const items = b.A.map((a, i) => [a, i]).filter(([, i]) => act[i]);
  $('annualList').innerHTML = items.map(([a, i]) => {
    const x = act[i], u = b.units[b.unitIndexOf(i)];
    return `<div class="buy ro"><div class="buy-name"><b>${esc(a.name)}</b><small>${u.g ? esc(u.g.name) : '미분류'}${acct(a)} · 지금 ${wonShort(b.vals[i])}</small></div>
      <div class="buy-amt num">${x.s < 0 ? '−' : '+'}${won(x.amt)}</div>
      <div class="buy-ctrl"><span class="act ${x.s < 0 ? 'sell' : 'buy'}">${side(a, x.s)}</span> <span class="num">${a.market === 'CASH' ? qtyText(x.q, a) : fmtQty(x.q, +a.unit || 1) + unitWord(a)}</span></div></div>`;
  }).join('') || '<p class="hint">매매할 종목이 없습니다.</p>';
  const rest0 = b.A.length - items.length;
  $('annualHold').textContent = rest0 && items.length ? `그 외 ${rest0}종목은 유지` : '';
  $('annualHint').textContent = items.length ? `매도 ${wonShort(sells)} · 매수 ${wonShort(buys)}` : '매매 없음';
  const taxLine = usGain > 0
    ? ` 미국 상장 자산 매도로 생기는 양도차익은 약 <b>${won(usGain)}</b>입니다(현재 환율로 단순 환산). 연 250만 원 공제를 넘는 부분은 22% 과세 대상입니다.`
    : '';
  $('annualNote').innerHTML = `매도 <b>${won(sells)}</b> · 매수 <b>${won(buys)}</b> · 적립금·이월 현금 <b>${won(b.budget)}</b> 반영 후 남는 현금 <b>${won(rest)}</b>. 매도 대금이 들어온 뒤 매수하세요.${taxLine}`;
  if (!annualTouched) $('secAnnual').open = annualOpenByDefault(new Date().getMonth() + 1, b.status) || tradeKind === 'annual';
}
$('secAnnual').querySelector('summary').addEventListener('click', () => { annualTouched = true; });

// 이번 달 살 것: 체크·−/+·직접 입력·가격 다름
const draftRow = el => { const c = el.closest('.buy[data-b]'); return c ? [draft[+c.dataset.b], c] : [null, null]; };
function touch(r) { r.touched = true; }
$('buyList').addEventListener('click', e => {
  const [r] = draftRow(e.target); if (!r) return;
  const a = assetBy(r.ticker); if (!a) return;
  const st = e.target.closest('[data-bstep]');
  if (st) {
    r.qty = stepQty(a, +r.qty || 0, +r.price || 0, +st.dataset.bstep, fxOf(prices()) || 0);
    r.on = r.qty > 0 ? true : r.on; touch(r); renderBuys(lastBoard); return;
  }
  if (e.target.closest('[data-bpopen]')) { r.priceOpen = true; touch(r); renderBuys(lastBoard); document.querySelector(`.buy[data-b="${draft.indexOf(r)}"] [data-bprice]`)?.focus(); }
});
// 체크·직접 입력은 그 카드와 합계만 바꾼다
function readBuyInput(e) {
  const [r, card] = draftRow(e.target); if (!r) return;
  const a = assetBy(r.ticker); if (!a) return;
  const t = e.target, fx = fxOf(prices()) || 0;
  if (t.matches('[data-bon]')) r.on = t.checked;
  else if (t.matches('[data-bqty]')) r.qty = Math.max(0, +t.value || 0);
  else if (t.matches('[data-bamt]')) r.qty = qtyFromAmount(a, t.value, +r.price || 0, fx);
  else if (t.matches('[data-bprice]')) r.price = Math.max(0, +t.value || 0);
  else return;
  touch(r); updateCard(card, r); updateBuyFoot();
}
$('buyList').addEventListener('input', readBuyInput);
$('buyList').addEventListener('change', readBuyInput);
$('buyFoot').addEventListener('click', e => {
  if (e.target.id === 'buyEditBtn') { buyEditing = !buyEditing; renderBuyFoot(); if (buyEditing) $('buyEdit').scrollIntoView({ block: 'nearest' }); }
});
$('buyMore').addEventListener('click', e => {
  if (e.target.id === 'buyAdd') {
    const t = $('buyAddSel').value, a = assetBy(t); if (!a) return;
    draft.push({ ticker: t, on: true, qty: a.market === 'CASH' ? 0 : floorTo(1, +a.unit || 1), plan: null, price: localPrice(prices(), a), touched: true, extra: true });
    renderBuys(lastBoard);
  }
});
$('buyFoot').addEventListener('click', async e => { if (e.target.id === 'buyApply') await submitDraft(); });
async function submitDraft() {
  const err = $('buyErr');
  if (state.example) { err.hidden = false; err.textContent = '예시 데이터에는 체결을 반영할 수 없습니다. 보유 자산 탭에서 내 종목을 추가해 주세요.'; return; }
  const fx = fxOf(prices()) || 0;
  const { trades } = draftTrades(draft, state.assets, { fx, budget: lastBoard.budget });
  if (!trades.length) return;
  draftBusy = true; updateBuyFoot();
  await sync.settle();
  const r = await api.applyTrades({ version: sync.version, kind: 'monthly', fx: fxOf(prices()), trades }).catch(() => ({ ok: false, error: '서버에 연결하지 못했습니다.' }));
  draftBusy = false;
  if (r.unauthorized) { updateBuyFoot(); $('buyErr').hidden = false; $('buyErr').textContent = '반영하려면 아래에서 로그인한 뒤 다시 눌러 주세요.'; sync.askForToken(); return; }
  if (r.conflict) { draft = []; sync.replace(r.doc, r.version); $('saveState').textContent = '다른 기기에서 수정돼 새로 불러왔습니다. 확인하고 다시 반영해 주세요.'; return; }
  if (!r.ok) { updateBuyFoot(); $('buyErr').hidden = false; $('buyErr').textContent = r.error; return; }
  draft = []; buyEditing = false;
  sync.replace(r.doc, r.version);
  $('saveState').textContent = '체결을 반영했습니다';
  showUndo('monthly', r.batch, r.spent, r.proceeds);
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
// 보유 자산: 그룹별 목록(평가액·수익률·비중). 종목을 누르면 아래에 입력 양식이 펼쳐진다.
let openAsset = -1;
function formHtml(a, i) {
    const cash = a.market === 'CASH';
    const codeFields = a.manual
      ? (cash
        ? `<div class="field f-cur"><label for="cu${i}">통화</label><select id="cu${i}" data-k="currency"><option value="KRW" ${!isUSD(a) ? 'selected' : ''}>원화</option><option value="USD" ${isUSD(a) ? 'selected' : ''}>USD</option></select></div>`
        : `<div class="field f-tk"><label for="k${i}">종목코드</label><input id="k${i}" data-k="ticker" value="${esc(a.ticker)}" autocapitalize="characters" spellcheck="false"></div>`)
        + `<div class="field f-mk"><label for="m${i}">시장</label><select id="m${i}" data-k="market">${Object.entries(MARKETS).map(([k, v]) => `<option value="${k}" ${a.market === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`
      : `<div class="code-ro f-tk">${LISTING[typeOf(a)] || '종목코드'}<span class="c">${esc(a.ticker)}</span></div><div class="code-ro f-mk">자산군<span>${clsChip(clsOf(a))}</span></div>`;
    return `
    <div class="asset" data-i="${i}" ${openAsset === i ? '' : 'hidden'}>
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
}
function headHtml(a, i, b) {
  const P = prices(), cash = a.market === 'CASH', ex = a.exclude;
  const j = b.A.indexOf(a), v = (+a.qty || 0) * krwPrice(P, a);
  const c = (+a.qty || 0) * (+a.avg || 0) * (isUSD(a) ? (fxOf(P) || 0) : 1), pr = c ? v - c : 0, cl = pr >= 0 ? 'up' : 'down';
  const q = quoteOf(P, a);
  let bar = '';
  if (j >= 0) {
    const u = b.units[b.unitIndexOf(j)], cur = b.cur[j], band = b.band;
    const maxScale = Math.max(10, ...b.A.map((x, k) => Math.max(b.cur[k], b.units[b.unitIndexOf(k)].w * 100 + band))) * 1.08;
    const sc = x => Math.min(100, Math.max(0, x / maxScale * 100));
    if (u.lead) bar = `<div class="track"><div class="fill" style="width:${sc(cur)}%;opacity:.55"></div></div><span class="hl-p num">${pct(cur)}<small> ${esc(u.label)} 합산</small></span>`;
    else {
      const tgt = u.w * 100, ad = Math.abs(cur - tgt), fc = ad > band ? 'far' : ad > band / 2 ? 'over' : '';
      bar = `<div class="track"><div class="band" style="left:${sc(tgt - band)}%;width:${sc(tgt + band) - sc(tgt - band)}%"></div><div class="fill ${fc}" style="width:${sc(cur)}%"></div><div class="tick" style="left:calc(${sc(tgt)}% - 1px)"></div></div><span class="hl-p num">${pct(cur)}<small> / ${pct(tgt)}</small></span>`;
    }
  }
  const sub = cash ? '현금·예금' + (isUSD(a) ? ' · 달러' : '') : qtyText(+a.qty || 0, a) + (q ? ' · ' + fmtLocal(q.close, a) : a.ticker ? ' · 가격 없음' : ' · 코드 필요');
  return `<div class="hl-n"><b>${esc(a.name || '이름 없음')}</b><small>${sub}${acct(a)}</small></div>
    <div class="hl-v num">${wonShort(v)}${cash || !c || ex ? '' : `<small class="${cl}">${spct(pr / c * 100)}</small>`}</div>
    ${bar ? `<div class="hl-bar">${bar}</div>` : ''}<span class="hl-chev" aria-hidden="true">${openAsset === i ? '▴' : '▾'}</span>`;
}
function renderAssets() {
  const A = state.assets || [], b = computeBoard(state, prices());
  const item = i => { const a = A[i]; return `<div class="ai${openAsset === i ? ' open' : ''}" data-ai="${i}">
    <button class="hl ai-head" type="button" data-open="${i}" aria-expanded="${openAsset === i}">${headHtml(a, i, b)}</button>${formHtml(a, i)}</div>`; };
  const G = state.groups || [], idx = A.map((a, i) => i);
  const sections = [
    ...G.map(g => [g.name, idx.filter(i => !A[i].exclude && A[i].group === g.id)]),
    ['미분류', idx.filter(i => !A[i].exclude && !G.some(g => g.id === A[i].group))],
    ['리밸런싱 제외', idx.filter(i => A[i].exclude)],
  ].filter(([, list]) => list.length);
  $('assets').innerHTML = sections.map(([name, list]) => `<div class="hl-g"><span class="label">${esc(name)}</span>${list.map(item).join('')}</div>`).join('')
    || '<p class="hint">아직 자산이 없습니다. 위의 종목 추가를 눌러 검색해 넣으세요.</p>';
  $('holdTotal').innerHTML = A.length ? `${b.A.length}종목 · ${wonShort(b.T)}${b.TC ? ` · <span class="${b.pl >= 0 ? 'up' : 'down'}">${signedWon(b.pl)}</span>` : ''}` : '';
  if (!A.length) showFinder(true);
}
function refreshAssetMeta() {
  const b = computeBoard(state, prices());
  document.querySelectorAll('.ai').forEach(el => {
    const i = +el.dataset.ai, a = state.assets[i]; if (!a) return;
    el.querySelector('.ai-head').innerHTML = headHtml(a, i, b);
    const f = el.querySelector('.asset');
    f.querySelector('.price-ro').outerHTML = priceCell(a);
    f.querySelector('.asset-total').innerHTML = totalLine(a);
  });
  $('holdTotal').innerHTML = state.assets.length ? `${b.A.length}종목 · ${wonShort(b.T)}${b.TC ? ` · <span class="${b.pl >= 0 ? 'up' : 'down'}">${signedWon(b.pl)}</span>` : ''}` : '';
}
function toggleAsset(i) {
  openAsset = openAsset === i ? -1 : i;
  document.querySelectorAll('.ai').forEach(el => {
    const on = +el.dataset.ai === openAsset;
    el.classList.toggle('open', on);
    el.querySelector('.asset').hidden = !on;
    const h = el.querySelector('.ai-head'); h.setAttribute('aria-expanded', on);
    const ch = h.querySelector('.hl-chev'); if (ch) ch.textContent = on ? '▴' : '▾';
  });
}
function showFinder(on) {
  $('finderBox').hidden = !on; $('addAssetBtn').setAttribute('aria-expanded', on);
  $('addAssetBtn').textContent = on ? '검색 닫기' : '+ 종목 추가';
}
$('addAssetBtn').addEventListener('click', () => { const on = $('finderBox').hidden; showFinder(on); if (on) $('q').focus(); });

/* ---------- 포트폴리오(그룹) ---------- */
const members = g => state.assets.map((a, i) => [a, i]).filter(([a]) => !a.exclude && a.group === g.id);
const groupOptions = sel => `<option value="">미분류</option>` + state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
function memRow(a, i, showInner) {
  return `<div class="mem">
    <div class="tgt-name"><b>${esc(a.name)}</b><span class="meta"><select class="cls-sel" data-move="${i}" aria-label="${esc(a.name)} 그룹 이동">${groupOptions(a.group)}</select>${a.account && a.account !== '일반' ? `<span class="sub-code">${esc(a.account)}</span>` : ''}</span></div>
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
        <div class="tgt-in"><input id="gt-${esc(g.id)}" class="num" data-gk="target" type="number" step="0.5" min="0" max="100" inputmode="decimal" value="${g.target ?? 0}" aria-label="${esc(g.name)} 목표 비중"></div>
        <button class="del" type="button" data-gdel="${esc(g.id)}" aria-label="${esc(g.name)} 그룹 삭제">✕</button>
      </div>
      <div class="grp-rule"><span>현재 <b class="num" data-gcur="${esc(g.id)}"></b></span>${multi ? `<label>규칙 <select data-gk="mode"><option value="ratio" ${!lead ? 'selected' : ''}>비율대로 나눠 사기</option><option value="lead" ${lead ? 'selected' : ''}>대표 종목만 사기</option></select></label>
        ${lead ? `<label>매수 <select data-gk="lead">${opts(g.lead || keyOf(M[0][0]))}</select></label><label>먼저 매도 <select data-gk="sell">${opts(g.sell || g.lead || keyOf(M[0][0]))}</select></label>` : '<span class="note">비율에 못 미치는 종목부터 사고, 넘치는 종목부터 팝니다</span>'}` : ''}</div>
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
  if ($('groups')) $('groups').innerHTML = parts.filter(p => p[1] > 0).map(([l, v, c]) => `<span><i class="sw" style="background:${c}"></i>${esc(l)} <b>${+v.toFixed(1)}%</b></span>`).join('');
  const s = targetSum(state);
  $('tgtSum').innerHTML = Math.abs(s - 100) > 0.01
    ? `<span class="warnline">목표 비중 합계 ${s.toFixed(1)}% · 100%로 맞춰 주세요 (지금은 비율로 환산 중)</span>` : '목표 비중 합계 100%';
}
function fillSettings() { $('monthly').value = state.monthly ?? ''; monthlyRead(); $('carry').value = state.carry ?? 0; $('bandIn').value = state.band ?? ''; }

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
  const op = e.target.closest('[data-open]');
  if (op) { toggleAsset(+op.dataset.open); return; }
  const i = e.target.dataset.del; if (i === undefined) return;
  const a = state.assets[+i];
  if (!confirm(`${a.name || '이 자산'}을(를) 삭제할까요?`)) return;
  state.assets.splice(+i, 1); openAsset = -1; changed(true);
});
const monthlyRead = () => { $('monthlyRead').textContent = +state.monthly > 0 ? '· ' + wonShort(+state.monthly) : ''; };
$('monthly').addEventListener('input', e => { state.monthly = +e.target.value; monthlyRead(); renderBoard(); edited(); });
document.querySelectorAll('[data-mstep]').forEach(bn => bn.addEventListener('click', () => {
  state.monthly = Math.max(0, Math.round(((+state.monthly || 0) + +bn.dataset.mstep) / 10000) * 10000);
  $('monthly').value = state.monthly; monthlyRead(); renderBoard(); edited();
}));
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
$('moveToggle').addEventListener('click', e => {
  const on = $('targets').classList.toggle('moving');
  e.currentTarget.setAttribute('aria-pressed', on); e.currentTarget.textContent = on ? '옮기기 끝' : '종목 옮기기';
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
  if (openAsset !== i) toggleAsset(i);
  const row = document.querySelector(`.ai[data-ai="${i}"]`); if (!row) return;
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
  if (r.unauthorized) { sync.askForToken(); }
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
  if (r.unauthorized) { err.hidden = false; err.textContent = '반영하려면 아래에 편집 암호를 입력한 뒤 다시 반영을 누르세요.'; sync.askForToken(); return; }
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
