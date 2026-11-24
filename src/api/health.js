// GET /api/health → {ok, db, passwordSet, ..., starter, usage}
// 배포 확인(scripts/check_site.mjs), 화면(편집 권한 안내), 앱 허브(app_starter docs/HUB.md)가 쓴다.
// 필드는 지우거나 이름을 바꾸지 않는다(예전 check_site·허브가 읽는다). 새 값은 추가만 한다.
import { json, passwordState, hubUrl, MIN_PASSWORD } from '../lib/http.js';

// 허브 연동 형식의 버전. 허브는 이 값이 없으면 "허브 준비 전 예전 앱"으로 본다.
export const STARTER_VERSION = 1;
const DAY_MS = 86400000;

// usage_log는 편집 권한이 있는 기기에서 열거나 저장했을 때만 쌓인다(src/lib/http.js logUsage).
// 방문자 수가 아니라 "주인이 실제로 쓰는지"를 보여 주는 값이다. 실패해도 health는 살린다(null).
export async function usageSummary(env, now = Date.now()) {
  try {
    const since = new Date(now - 30 * DAY_MS).toISOString().replace(/\.\d+Z$/, 'Z');
    const r = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM usage_log WHERE ts >= ?) AS n, (SELECT MAX(ts) FROM usage_log) AS last'
    ).bind(since).first();
    return { last30d: Number(r?.n) || 0, lastUsedAt: r?.last || null };
  } catch {
    return null;
  }
}

export async function GET({ env }) {
  // Supabase 모드: D1이 없다. DB는 Supabase가 맡고, 여기서는 Worker가 살아 있는지만 알린다.
  if (!env.DB) return json({ ok: true, db: null, mode: 'supabase', starter: STARTER_VERSION, usage: null });
  let db = false;
  try { db = (await env.DB.prepare('SELECT 1 AS one').first())?.one === 1; } catch { db = false; }
  const pw = await passwordState(env);
  return json({
    ok: true, db,
    passwordSet: pw.set, passwordSource: pw.source, passwordMinLength: MIN_PASSWORD,
    writeTokenSet: Boolean(env.WRITE_TOKEN), // 예전 check_site·허브가 읽는다(지우지 않는다)
    starter: STARTER_VERSION, usage: db ? await usageSummary(env) : null,
    // 허브 로그인을 쓰면 화면이 "허브에서 로그인 →" 링크를 보여 준다(app_starter docs/HUB.md "허브 로그인").
    ...(hubUrl(env) ? { auth: 'hub', hubLogin: hubUrl(env) + '/?login=1' } : { auth: 'password' }),
  }, db ? 200 : 503);
}
