// 배포된 사이트를 검사한다. 사용법: node scripts/check_site.mjs https://my-app.<계정>.workers.dev
// 화면·API·D1 연결·편집 암호 보호를 확인하고, 하나라도 실패하면 종료 코드 1.
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('사이트 주소를 넣어 주세요. 예: node scripts/check_site.mjs https://my-app.me.workers.dev'); process.exit(2); }

const checks = [];
async function check(name, fn) {
  try { const note = await fn(); checks.push([true, name, note || '']); }
  catch (e) { checks.push([false, name, e.message]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('첫 화면', async () => {
  const r = await fetch(base + '/'); expect(r.ok, 'HTTP ' + r.status);
  expect((r.headers.get('content-type') || '').includes('text/html'), 'HTML이 아님');
});
let mode = 'd1';
await check('Worker·DB 연결 (/api/health)', async () => {
  const r = await fetch(base + '/api/health'); const j = await r.json().catch(() => ({}));
  if (j.mode === 'supabase') { mode = 'supabase'; expect(r.ok, 'HTTP ' + r.status); return 'Supabase 모드'; }
  expect(r.ok && j.db, 'D1에 연결되지 않음: HTTP ' + r.status + ' ' + JSON.stringify(j));
  return j.writeTokenSet ? 'D1 모드, 편집 암호 설정됨' : '경고: 편집 암호(WRITE_TOKEN)가 아직 없음 — 저장이 모두 막힌다';
});
if (mode === 'd1') {
  await check('문서 읽기 (/api/doc)', async () => {
    const r = await fetch(base + '/api/doc'); const j = await r.json(); expect(r.ok && 'version' in j, 'HTTP ' + r.status);
    return 'version ' + j.version;
  });
  await check('암호 없이 저장하면 거절', async () => {
    const r = await fetch(base + '/api/doc', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"doc":{},"version":0}' });
    expect(r.status === 401, '401이어야 하는데 ' + r.status);
  });
} else {
  let cfg = {};
  await check('Supabase 연결 정보 (js/config.js)', async () => {
    const t = await (await fetch(base + '/js/config.js')).text();
    cfg.url = (t.match(/SUPABASE_URL = '([^']+)'/) || [])[1]; cfg.key = (t.match(/SUPABASE_KEY = '([^']+)'/) || [])[1];
    expect(cfg.url && !cfg.url.startsWith('__') && cfg.key, 'config.js가 채워지지 않음');
    // 서비스 키가 화면에 들어가면 RLS를 무시하고 모든 데이터를 읽고 쓸 수 있다. 키 값 자체를 검사한다(주석은 보지 않는다).
    let role = '';
    try { role = JSON.parse(Buffer.from(cfg.key.split('.')[1] || '', 'base64url').toString()).role || ''; } catch { role = ''; }
    expect(!cfg.key.startsWith('sb_secret_') && role !== 'service_role', '서비스 키(secret)가 화면에 들어 있음 — 바로 빼야 한다');
    return cfg.url;
  });
  if (cfg.url) {
    await check('Supabase 응답 (keepalive 함수)', async () => {
      const r = await fetch(cfg.url + '/rest/v1/rpc/keepalive', { method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, body: '{}' });
      expect(r.ok, 'HTTP ' + r.status + ' — supabase/schema.sql을 적용했는지 확인');
    });
    await check('로그인 없이는 데이터가 안 보임 (RLS)', async () => {
      const r = await fetch(cfg.url + '/rest/v1/notes?select=id&limit=1', { headers: { apikey: cfg.key } });
      const j = await r.json().catch(() => null);
      expect(r.ok && Array.isArray(j) && j.length === 0, '로그인 없이 행이 보임 — RLS 정책 확인: ' + JSON.stringify(j).slice(0, 120));
    });
  }
}
await check('없는 주소는 404', async () => {
  const r = await fetch(base + '/no-such-page-' + Date.now()); expect(r.status === 404, 'HTTP ' + r.status);
});

for (const [ok, name, note] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
process.exit(checks.every(c => c[0]) ? 0 : 1);
