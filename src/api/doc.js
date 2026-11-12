// GET /api/doc → {doc, version}
// PUT /api/doc  {doc, version} → {version} | 409 {doc, version}(다른 기기에서 먼저 수정) | 401(편집 암호 없음)
import { json, canWrite, logUsage, nowIso } from '../lib/http.js';

export const EMPTY = {};
const MAX_BYTES = 256 * 1024;

async function current(env) {
  const row = await env.DB.prepare('SELECT body, version FROM doc WHERE id = 1').first();
  return row ? { doc: JSON.parse(row.body), version: row.version } : { doc: EMPTY, version: 0 };
}

export async function GET({ request, env }) {
  const body = await current(env);
  if (canWrite(request, env)) await logUsage(env, 'open');
  return json(body);
}

export async function PUT({ request, env }) {
  if (!canWrite(request, env)) return json({ detail: '편집 암호가 필요합니다.' }, 401);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ detail: '문서가 너무 큽니다.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ detail: 'JSON이 아닙니다.' }, 400); }
  const { doc, version } = body || {};
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Number.isInteger(version)) {
    return json({ detail: '{doc, version} 형식이어야 합니다.' }, 422);
  }
  const s = JSON.stringify(doc), now = nowIso();
  const r = version === 0
    ? await env.DB.prepare('INSERT OR IGNORE INTO doc (id, body, version, updated_at) VALUES (1, ?, 1, ?)').bind(s, now).run()
    : await env.DB.prepare('UPDATE doc SET body = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?').bind(s, now, version).run();
  if (r.meta.changes !== 1) return json(await current(env), 409);
  await logUsage(env, 'save');
  return json({ version: version + 1 });
}
