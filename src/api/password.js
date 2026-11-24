// POST /api/password {password} → 201 | 409(이미 정해짐) | 422(너무 짧음)
// 편집 암호를 사이트에서 처음 한 번 정한다. 대시보드 단계를 없애려는 것이다.
// 이미 정해졌으면(대시보드 Secret WRITE_TOKEN 또는 앞서 사이트에서 정한 값) 거절한다.
// 바꾸거나 잊었을 때: AI에게 "편집 암호 초기화"를 부탁하면 D1 settings의 write_hash 행을 지운다(app_starter docs/AGENT_SETUP.md 6-3).
import { json, claimPassword, MIN_PASSWORD, MAX_PASSWORD } from '../lib/http.js';

export async function POST({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ detail: 'JSON이 아닙니다.' }, 400); }
  const password = typeof body?.password === 'string' ? body.password.trim() : '';
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return json({ detail: `편집 암호는 ${MIN_PASSWORD}~${MAX_PASSWORD}자여야 합니다.` }, 422);
  }
  if (!(await claimPassword(env, password))) return json({ detail: '편집 암호가 이미 정해져 있습니다.' }, 409);
  return json({ ok: true }, 201);
}
