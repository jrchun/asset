// 숫자·통화 표시(docs/DESIGN.md 6장). 마이너스는 U+2212(−)를 쓴다.
import { isUSD } from './rebalance.js';

export const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
export function wonShort(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e8) return s + (a / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억원';
  if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원';
  return s + Math.round(a).toLocaleString('ko-KR') + '원';
}
export const signedWon = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.round(Math.abs(n)).toLocaleString('ko-KR') + '원';
export const pct = n => n.toFixed(1) + '%';
export const spct = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
export const pp = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(1) + '%p';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtQty = (q, unit) => unit >= 1 ? Math.round(q).toLocaleString('ko-KR') : (+(+q).toFixed(8)).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
export const usd = v => '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtLocal = (v, a) => isUSD(a) ? usd(v) : Math.round(v).toLocaleString('ko-KR') + '원';
export const unitWord = a => a.market === 'GOLD' ? 'g' : a.market === 'CRYPTO' ? '개' : a.market === 'CASH' ? (a.currency === 'USD' ? '달러' : '원') : '주';
// 수량 + 단위. 현금은 금액으로 쓴다: "185,043원", "$136.5"
export function qtyText(q, a) {
  if (a.market === 'CASH') return a.currency === 'USD' ? usd(q) : Math.round(q).toLocaleString('ko-KR') + '원';
  return fmtQty(q, +a.unit || 1) + unitWord(a);
}
export function capText(eok) {
  return eok >= 10000 ? (eok / 10000).toFixed(eok >= 100000 ? 0 : 1) + '조' : Math.round(eok).toLocaleString('ko-KR') + '억';
}
