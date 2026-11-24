// Worker API 공용 도구.

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// 편집 암호. 읽기는 누구나, 쓰기는 암호를 아는 사람만.
// 쓰기 허락은 다음 중 하나다.
//   1) Worker 비밀값 WRITE_TOKEN(대시보드에서 넣은 것). 있으면 언제나 통한다(비상용).
//   2) 허브 로그인(HUB_URL이 있을 때, docs/HUB.md "허브 로그인"): 허브에서 한 번 로그인하면 브라우저에 쿠키 hub_session이
//      내 도메인 전체에 생긴다. 그 값을 허브 /api/session에 물어 진짜면 통과. 이때 앱별 암호(3)는 쓰지 않는다.
//   3) 사이트에서 처음 한 번 정한 암호(D1 settings 표에 소금 + SHA-256 해시로 저장, 원문은 저장하지 않음).
// 아무것도 없으면 쓰기를 모두 막는다(화면이 "허브에서 로그인" 또는 "편집 암호 정하기"를 보여 준다).
const PASSWORD_KEY = 'write_hash';
export const MIN_PASSWORD = 6;   // 화면은 /api/health의 passwordMinLength로 이 값을 받아 쓴다
export const MAX_PASSWORD = 200;

const bearer = request => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  salt ||= [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  return salt + ':' + await sha256hex(salt + password);
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash || !password) return false;
  return safeEqual(await sha256hex(salt + password), hash);
}

async function storedHash(env) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(PASSWORD_KEY).first();
    return row ? row.value : null;
  } catch { return null; } // settings 표가 아직 없으면(예전 스키마) 암호 없음으로 본다
}

// 허브 로그인을 쓰는가(wrangler.toml [vars] HUB_URL, cf_mcp.mjs fill이 넣는다).
export const hubUrl = env => String(env.HUB_URL || '').replace(/\/+$/, '');

// 편집 암호가 정해져 있는가. source: 'secret'(대시보드) | 'hub'(허브 로그인) | 'site'(사이트에서 정함) | null
export async function passwordState(env) {
  if (env.WRITE_TOKEN) return { set: true, source: 'secret' };
  if (hubUrl(env)) return { set: true, source: 'hub' };
  return (await storedHash(env)) ? { set: true, source: 'site' } : { set: false, source: null };
}

export async function canWrite(request, env, fetchFn = fetch) {
  const got = bearer(request);
  if (got && env.WRITE_TOKEN && safeEqual(got, env.WRITE_TOKEN)) return true;
  if (hubUrl(env)) return hubSession(request, env, fetchFn);
  if (!got || env.WRITE_TOKEN) return false;
  return verifyPassword(got, await storedHash(env));
}

// ── 허브 로그인 ───────────────────────────────────────────────
const HUB_COOKIE = 'hub_session';
const HUB_CACHE_MS = 5 * 60_000; // 확인 결과를 5분 기억한다(허브에서 로그아웃해도 이 앱에는 최대 5분 뒤 반영)
const hubCache = new Map();       // 쿠키 값 → 기억 만료 시각(밀리초). Worker가 다시 뜨면 비워진다.

export function readCookie(request, name = HUB_COOKIE) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// 요청의 허브 로그인 표시가 진짜인지 허브에 묻는다. 허브가 안 받으면(멈춤 등) false = 저장 못 함(읽기는 된다).
export async function hubSession(request, env, fetchFn = fetch, now = Date.now()) {
  const token = readCookie(request);
  if (!token || token.length > 200) return false;
  const until = hubCache.get(token);
  if (until && until > now) return true;
  try {
    const res = await fetchFn(hubUrl(env) + '/api/session', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'app-starter/1' },
      body: JSON.stringify({ token }), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (j?.ok !== true) return false;
    if (hubCache.size > 200) hubCache.clear();
    hubCache.set(token, Math.min(now + HUB_CACHE_MS, Number(j.exp) * 1000 || now));
    return true;
  } catch {
    return false;
  }
}

// 처음 한 번만 성공한다. 이미 정해졌거나 허브 로그인을 쓰면 false.
export async function claimPassword(env, password) {
  if (env.WRITE_TOKEN || hubUrl(env)) return false;
  const r = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .bind(PASSWORD_KEY, await hashPassword(password)).run();
  return r.meta.changes === 1;
}

export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export async function logUsage(env, event) {
  await env.DB.prepare('INSERT INTO usage_log (ts, event) VALUES (?, ?)').bind(nowIso(), event).run();
}
