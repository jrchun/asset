// GET /api/snapshots → { snapshots: [{ date, total, doc }] } 최근 것부터 최대 60개(월말 평가 기록)
import { json } from '../lib/http.js';

export async function GET({ env }) {
  const { results } = await env.DB.prepare('SELECT date, total, doc FROM snapshots ORDER BY date DESC LIMIT 60').all();
  return json({ snapshots: (results || []).map(r => ({ date: r.date, total: r.total, doc: JSON.parse(r.doc) })) });
}
