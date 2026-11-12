// 체결 반영과 기록.
// GET  /api/trades                 → { trades: [...] } 최근 300건
// POST /api/trades/apply  { version, kind, fx, trades:[{ticker, side, qty, price}] }
//        → { doc, version, batch, spent, proceeds } | 409 { doc, version }(다른 기기에서 먼저 수정) | 401
// POST /api/trades/undo   { batch } → { doc, version } | 409(반영 뒤 다른 수정이 있음)
// 문서 갱신과 기록은 한 번의 D1 batch(트랜잭션)로 한다. 기록 문장은 "문서가 방금 쓴 내용과 같을 때만" 들어가므로,
// 버전이 맞지 않아 문서가 바뀌지 않으면 기록도 남지 않는다.
import { json, canWrite, logUsage, nowIso } from '../lib/http.js';
import { applyTrades } from '../../web/js/rebalance.js';
import { loadDoc } from '../prices/collect.js';
import { localParts } from '../prices/sources.js';

const KINDS = ['monthly', 'annual', 'manual'];
const GUARD = '(SELECT version FROM doc WHERE id = 1) = ? AND (SELECT body FROM doc WHERE id = 1) = ?';

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export async function GET({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, batch, date, ticker, side, qty, price, currency, fx, kind FROM trades ORDER BY id DESC LIMIT 300').all();
  return json({ trades: results || [] });
}

export async function apply({ request, env }) {
  if (!canWrite(request, env)) return json({ detail: '편집 암호가 필요합니다.' }, 401);
  const body = await readJson(request);
  if (!body || !Number.isInteger(body.version) || !Array.isArray(body.trades)) return json({ detail: '{version, kind, trades} 형식이어야 합니다.' }, 422);
  const kind = KINDS.includes(body.kind) ? body.kind : 'manual';
  const cur = await loadDoc(env);
  if (cur.version === 0) return json({ detail: '포트폴리오가 아직 저장되지 않았습니다. 값을 하나 고쳐 저장한 뒤 다시 해 주세요.' }, 422);
  if (cur.version !== body.version) return json(cur, 409);

  let fx = +body.fx;
  if (!(fx > 0)) fx = (await env.DB.prepare('SELECT usdkrw FROM fx ORDER BY date DESC LIMIT 1').first())?.usdkrw || 0;
  let res;
  try { res = applyTrades(cur.doc, body.trades, { fx }); } catch (e) { return json({ detail: e.message }, 422); }
  if (!res.rows.length) return json({ detail: '반영할 체결이 없습니다. 수량을 확인해 주세요.' }, 422);

  const prev = JSON.stringify(cur.doc), next = JSON.stringify(res.doc), nv = cur.version + 1, now = nowIso();
  const date = localParts(new Date(), 'Asia/Seoul').date;
  const stmts = [
    env.DB.prepare('UPDATE doc SET body = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?').bind(next, now, cur.version),
    env.DB.prepare(`INSERT INTO trade_batches (ts, kind, prev_doc, new_version) SELECT ?, ?, ?, ? WHERE ${GUARD}`).bind(now, kind, prev, nv, nv, next),
    ...res.rows.map(r => env.DB.prepare(
      `INSERT INTO trades (batch, date, ticker, side, qty, price, currency, fx, kind)
       SELECT (SELECT MAX(id) FROM trade_batches), ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GUARD}`)
      .bind(date, r.ticker, r.side, r.qty, r.price, r.currency, r.fx, kind, nv, next)),
  ];
  const out = await env.DB.batch(stmts);
  if (out[0].meta.changes !== 1) return json(await loadDoc(env), 409);
  const batch = (await env.DB.prepare('SELECT MAX(id) AS id FROM trade_batches WHERE new_version = ?').bind(nv).first())?.id;
  await logUsage(env, 'apply_trades');
  return json({ doc: res.doc, version: nv, batch, spent: res.spent, proceeds: res.proceeds });
}

export async function undo({ request, env }) {
  if (!canWrite(request, env)) return json({ detail: '편집 암호가 필요합니다.' }, 401);
  const body = await readJson(request);
  const id = body && Number.isInteger(body.batch) ? body.batch : null;
  if (!id) return json({ detail: '{batch} 형식이어야 합니다.' }, 422);
  const b = await env.DB.prepare('SELECT id, prev_doc, new_version, undone FROM trade_batches WHERE id = ?').bind(id).first();
  if (!b) return json({ detail: '체결 기록을 찾지 못했습니다.' }, 404);
  const cur = await loadDoc(env);
  if (b.undone || cur.version !== b.new_version) {
    return json({ ...cur, detail: '반영 뒤에 다른 수정이 있어 되돌리지 못했습니다. 수량을 직접 고쳐 주세요.' }, 409);
  }
  const nv = cur.version + 1, now = nowIso();
  const out = await env.DB.batch([
    env.DB.prepare('UPDATE doc SET body = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?').bind(b.prev_doc, now, cur.version),
    env.DB.prepare(`DELETE FROM trades WHERE batch = ? AND ${GUARD}`).bind(id, nv, b.prev_doc),
    env.DB.prepare(`UPDATE trade_batches SET undone = 1 WHERE id = ? AND ${GUARD}`).bind(id, nv, b.prev_doc),
  ]);
  if (out[0].meta.changes !== 1) return json(await loadDoc(env), 409);
  await logUsage(env, 'undo_trades');
  return json({ doc: JSON.parse(b.prev_doc), version: nv });
}
