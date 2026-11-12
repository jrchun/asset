// GET /api/health → {ok, db} : 배포 확인용(scripts/check_site.mjs가 쓴다).
import { json } from '../lib/http.js';

export async function GET({ env }) {
  // Supabase 모드: D1이 없다. DB는 Supabase가 맡고, 여기서는 Worker가 살아 있는지만 알린다.
  if (!env.DB) return json({ ok: true, db: null, mode: 'supabase' });
  let db = false;
  try { db = (await env.DB.prepare('SELECT 1 AS one').first())?.one === 1; } catch { db = false; }
  return json({ ok: true, db, writeTokenSet: Boolean(env.WRITE_TOKEN) }, db ? 200 : 503);
}
