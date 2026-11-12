// 숫자 표기(docs/DESIGN.md 6장). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wonShort, signedWon, pp, spct, qtyText, fmtQty } from '../web/js/format.js';

test('큰 금액은 억원·만원, 손익은 부호와 U+2212', () => {
  assert.equal(wonShort(125000000), '1.25억원');
  assert.equal(wonShort(76030000), '7,603만원');
  assert.equal(wonShort(-5000), '−5,000원');
  assert.equal(signedWon(234938), '+234,938원');
  assert.equal(signedWon(-2543220), '−2,543,220원');
  assert.equal(pp(1.23), '+1.2%p');
  assert.equal(spct(-21.614), '−21.61%');
});

test('수량: 단위가 1 이상이면 정수, 현금은 금액에 원·달러를 붙인다', () => {
  assert.equal(fmtQty(461, 1), '461');
  assert.equal(fmtQty(0.11803342, 0.0001), '0.11803342');
  assert.equal(qtyText(185043, { market: 'CASH' }), '185,043원');
  assert.equal(qtyText(136.5, { market: 'CASH', currency: 'USD' }), '$136.5');
  assert.equal(qtyText(52, { market: 'GOLD', unit: 1 }), '52g');
});
