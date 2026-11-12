// 예약 작업(Cron Trigger). wrangler.toml의 [triggers] crons 시각에 Cloudflare가 worker.js의 scheduled()를 부른다.
// Worker 안에서 바로 D1·Supabase에 닿으므로 GitHub 비밀이나 API 토큰이 필요 없다.
import { nowIso } from './lib/http.js';
import { collectPrices, priceDoc, loadDoc } from './prices/collect.js';
import { localParts } from './prices/sources.js';
import { snapshotOf } from '../web/js/rebalance.js';

// D1 모드: 매일 07:30 KST(wrangler.toml)에 보유 종목의 전일 종가와 환율을 받아 저장한다.
// 그날이 그 달의 마지막 날(KST)이면 수집 뒤에 월말 평가 기록(snapshots)을 남긴다.
export async function daily(env, { fetchFn = fetch, now = new Date() } = {}) {
  const r = await collectPrices(env, { fetchFn, now });
  let note = `가격 갱신 ${r.updated.length}건, 실패 ${r.failed.length}건` + (r.fx ? `, 환율 ${r.fx.usdkrw}` : ', 환율 없음');
  if (isLastDayOfMonth(now)) note += ', ' + await saveSnapshot(env, now);
  await env.DB.prepare('INSERT INTO job_log (ts, job, note) VALUES (?, ?, ?)').bind(nowIso(), 'daily', note).run();
  return note;
}

export function isLastDayOfMonth(now) {
  const today = localParts(now, 'Asia/Seoul').date;
  const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
}

export async function saveSnapshot(env, now = new Date()) {
  const { doc } = await loadDoc(env);
  if (!(doc.assets || []).length) return '월말 기록 없음(종목 없음)';
  const snap = snapshotOf(doc, await priceDoc(env, now));
  const date = localParts(now, 'Asia/Seoul').date;
  await env.DB.prepare('INSERT OR REPLACE INTO snapshots (date, total, doc) VALUES (?, ?, ?)').bind(date, snap.total, JSON.stringify(snap)).run();
  return `월말 기록 ${date}`;
}

// Supabase 모드: 무료 플랜은 7일 동안 요청이 없으면 프로젝트를 멈추므로 하루 한 번 깨운다(공개 키만 쓴다).
export async function supabaseKeepalive(env, fetchFn = fetch) {
  const r = await fetchFn(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/keepalive', {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error('Supabase keepalive 실패: HTTP ' + r.status);
  return 'Supabase 응답 ' + r.status;
}

export async function runScheduled(env, fetchFn = fetch) {
  const done = [];
  if (env.DB) done.push(await daily(env, { fetchFn }));
  if (env.SUPABASE_URL && env.SUPABASE_KEY) done.push(await supabaseKeepalive(env, fetchFn));
  return done.join(', ') || '할 일 없음';
}
