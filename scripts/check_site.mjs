// 배포된 사이트를 검사한다. 사용법: node scripts/check_site.mjs https://my-app.<계정>.workers.dev
// 화면·API·D1 연결·편집 암호 보호를 확인하고, 하나라도 실패하면 종료 코드 1.
// 앱 허브 준비(app.json·starter·og.png, docs/HUB.md)는 "경고"만 한다. 예전 앱에도 이 스크립트를 쓸 수 있게.
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('사이트 주소를 넣어 주세요. 예: node scripts/check_site.mjs https://my-app.me.workers.dev'); process.exit(2); }

const checks = []; // [상태('ok'|'FAIL'|'warn'), 이름, 설명]
async function check(name, fn, { warnOnly = false } = {}) {
  try { const note = await fn(); checks.push(['ok', name, note || '']); }
  catch (e) { checks.push([warnOnly ? 'warn' : 'FAIL', name, e.message]); }
}
const hub = (name, fn) => check(name, fn, { warnOnly: true });
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('첫 화면', async () => {
  const r = await fetch(base + '/'); expect(r.ok, 'HTTP ' + r.status);
  expect((r.headers.get('content-type') || '').includes('text/html'), 'HTML이 아님');
});
let mode = 'd1', health = {};
await check('Worker·DB 연결 (/api/health)', async () => {
  const r = await fetch(base + '/api/health'); const j = await r.json().catch(() => ({})); health = j;
  if (j.mode === 'supabase') { mode = 'supabase'; expect(r.ok, 'HTTP ' + r.status); return 'Supabase 모드'; }
  expect(r.ok && j.db, 'D1에 연결되지 않음: HTTP ' + r.status + ' ' + JSON.stringify(j));
  if (j.auth === 'hub') return 'D1 모드, 허브 로그인(' + (j.hubLogin || '').replace(/\/\?login=1$/, '') + ')';
  const set = j.passwordSet ?? j.writeTokenSet;
  return set ? 'D1 모드, 편집 암호 정해짐' : '알림: 편집 암호가 아직 없음 — 사이트에서 처음 저장할 때 정한다(주소를 공유하기 전에 정할 것)';
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
await hub('앱 허브: 자기소개서 (/app.json)', async () => {
  const r = await fetch(base + '/app.json'); expect(r.ok, 'HTTP ' + r.status + ' — web/app.json이 없음(docs/HUB.md)');
  const j = await r.json().catch(() => null); expect(j && typeof j === 'object', 'JSON이 아님');
  const missing = ['schema', 'name', 'summary', 'status'].filter(k => !j[k]);
  expect(!missing.length, '빠진 필드: ' + missing.join(', '));
  return `${j.name} · ${j.status}`;
});
await hub('앱 허브: 버전 (/api/health의 starter)', async () => {
  expect(health.starter, 'starter 값이 없음 — 허브 준비 전 예전 앱(docs/HUB.md 2번)');
  const u = health.usage;
  return `starter ${health.starter}` + (u ? `, 최근 30일 사용 ${u.last30d}회` : '');
});
await hub('앱 허브: 대표 화면 (/og.png)', async () => {
  const r = await fetch(base + '/og.png'); expect(r.ok, 'HTTP ' + r.status + ' — node scripts/og_shot.mjs로 찍어 커밋');
  expect((r.headers.get('content-type') || '').includes('image/png'), 'PNG가 아님');
  const kb = Math.round((await r.arrayBuffer()).byteLength / 1024);
  return kb + 'KB' + (kb > 200 ? ' (200KB보다 큼)' : '');
});
await check('없는 주소는 404', async () => {
  const r = await fetch(base + '/no-such-page-' + Date.now()); expect(r.status === 404, 'HTTP ' + r.status);
});

for (const [state, name, note] of checks) console.log(`${state.padEnd(4)} ${name}${note ? ' — ' + note : ''}`);
process.exit(checks.some(c => c[0] === 'FAIL') ? 1 : 0);
