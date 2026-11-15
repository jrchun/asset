// Cloudflare MCP의 execute 안에서 실행되는 함수들. scripts/cf_mcp.mjs가 이 함수의 소스와 값을 묶어 코드 파일로 만든다.
//
// 규칙(execute 안에서는 이 파일의 다른 함수나 import를 볼 수 없다):
//   - 각 함수는 혼자 완결되어야 한다. 바깥 변수·다른 함수·import를 쓰지 않는다.
//   - 인자는 (P, cloudflare, accountId). P는 cf_mcp.mjs가 넘기는 값(JSON으로 바꿀 수 있는 것만).
//   - cloudflare.request({ method, path, query, body })만 쓴다. 실패하면 예외가 난다.
// tests/cf_mcp.test.js가 가짜 cloudflare로 이 함수들을 직접 돌려 본다.

// address: 읽기만 한다. 사이트 주소가 어떻게 될지 알려 준다(기획 요약의 "이 주소로 됩니다").
export async function address(P, cloudflare, accountId) {
  let sub = null;
  try { sub = (await cloudflare.request({ method: 'GET', path: `/accounts/${accountId}/workers/subdomain` })).result?.subdomain || null; } catch { sub = null; }
  const workers = (await cloudflare.request({ method: 'GET', path: `/accounts/${accountId}/workers/scripts` })).result.map(w => w.id);
  if (sub) {
    return {
      name: P.name, account_subdomain: sub, url: `https://${P.name}.${sub}.workers.dev`,
      name_taken_in_account: workers.includes(P.name),
      note: '계정 이름은 이미 정해져 있어 AI가 바꾸지 않는다. 앱 이름만 고를 수 있다.',
    };
  }
  return {
    name: P.name, account_subdomain: null,
    proposals: P.proposals.map(p => ({ subdomain: p, url: `https://${P.name}.${p}.workers.dev` })),
    note: '처음 쓰는 계정이다. 계정 이름은 한 번 정하면 바꿀 수 없고 모든 앱 주소에 들어간다. 기획자에게 골라 받은 뒤 prepare --subdomain으로 만든다.',
  };
}

// prepare: D1 찾기·만들기, 스키마 적용, 사이트 주소 확인.
// 계정 이름(workers.dev 하위 도메인)은 아직 없고 기획자가 확인한 이름(P.confirmedSubdomain)이 있을 때만 만든다.
export async function prepare(P, cloudflare, accountId) {
  const out = { account_id: accountId, name: P.name };
  if (P.wantD1) {
    const base = `/accounts/${accountId}/d1/database`;
    let db = (await cloudflare.request({ method: 'GET', path: base, query: { name: P.name } })).result.find(d => d.name === P.name);
    out.d1_created = !db;
    if (!db) db = (await cloudflare.request({ method: 'POST', path: base, body: { name: P.name, primary_location_hint: 'apac' } })).result;
    const q = await cloudflare.request({ method: 'POST', path: `${base}/${db.uuid}/query`, body: { sql: P.schema } });
    out.database_id = db.uuid;
    out.schema_statements = q.result.length;
  }

  const subPath = `/accounts/${accountId}/workers/subdomain`;
  let sub = null;
  try { sub = (await cloudflare.request({ method: 'GET', path: subPath })).result?.subdomain || null; } catch { sub = null; }
  if (!sub && P.confirmedSubdomain) {
    // 이미 있으면 sub가 채워져 여기로 오지 않는다(기존 앱 주소 보호).
    try {
      sub = (await cloudflare.request({ method: 'PUT', path: subPath, body: { subdomain: P.confirmedSubdomain } })).result?.subdomain || P.confirmedSubdomain;
      out.subdomain_created = true;
    } catch (e) { out.subdomain_error = String(e.message || e).slice(0, 200); }
  }

  out.subdomain = sub;
  if (sub) {
    out.url = `https://${P.name}.${sub}.workers.dev`;
    if (P.confirmedSubdomain && sub !== P.confirmedSubdomain) out.subdomain_note = `계정 이름이 이미 ${sub}(으)로 정해져 있어 그대로 쓴다.`;
  } else {
    out.subdomain_note = P.confirmedSubdomain
      ? '그 계정 이름은 만들 수 없었다(다른 사람이 쓰는 중일 수 있음). 기획자에게 다른 이름을 받아 --subdomain으로 다시 실행한다.'
      : '계정 이름(workers.dev 하위 도메인)이 아직 없다. address로 후보를 받아 기획자에게 확인한 뒤 --subdomain으로 다시 실행한다.';
  }
  return out;
}

// connect: Workers Builds API로 대시보드의 "만들기 › GitHub"를 대신한다. 저장소를 연결하고 첫 빌드를 시작한다.
// 필요한 것: 커넥터의 Workers CI 쓰기 권한, GitHub에 Cloudflare 앱 설치(계정당 처음 한 번은 사람), 기존 배포용 토큰.
// 하나라도 없으면 ok:false와 단계(step)·이유(note)를 돌려준다. 그때는 사람이 대시보드에서 연결한다.
export async function connect(P, cloudflare, accountId) {
  const base = `/accounts/${accountId}`;
  const out = { name: P.name, repo: `${P.owner}/${P.repo}` };
  const fail = (step, note, e) => ({ ...out, ok: false, step, note, error: e ? String(e.message || e).slice(0, 400) : undefined });
  const findWorker = async () => (await cloudflare.request({ method: 'GET', path: `${base}/workers/scripts` })).result.find(s => s.id === P.name);

  let tokens;
  try { tokens = (await cloudflare.request({ method: 'GET', path: `${base}/builds/tokens` })).result || []; } catch (e) {
    return fail('권한', '커넥터에 Workers CI 권한이 없다. 커넥터를 다시 연결하며 Workers CI 쓰기를 허용하거나, 사람이 대시보드 "만들기 › GitHub"로 연결한다.', e);
  }
  if (!tokens.length) return fail('배포용 토큰', '배포용 토큰(build token)이 없다. 이 계정의 첫 연결이라 사람이 대시보드 "만들기 › GitHub"로 한 번 연결해야 한다.');

  let w = await findWorker();
  if (!w) {
    // 연결하려면 Worker가 먼저 있어야 한다. 첫 빌드가 끝나면 진짜 앱으로 바뀌는 자리 표시 Worker를 만든다.
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: 'index.js', compatibility_date: P.compatibilityDate })], { type: 'application/json' }));
    form.append('index.js', new Blob([
      "export default { fetch: () => new Response('배포 준비 중입니다. 1~2분 뒤 새로고침해 주세요.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }) };",
    ], { type: 'application/javascript+module' }), 'index.js');
    await cloudflare.request({ method: 'PUT', path: `${base}/workers/scripts/${P.name}`, body: form });
    await cloudflare.request({ method: 'POST', path: `${base}/workers/scripts/${P.name}/subdomain`, body: { enabled: true, previews_enabled: false } });
    w = await findWorker();
    out.placeholder_created = true;
  }

  let connected = false;
  try { connected = Boolean((await cloudflare.request({ method: 'GET', path: `${base}/builds/workers/${w.tag}` })).result?.git_repository); } catch { connected = false; }
  if (connected) {
    out.already_connected = true; // 다시 실행해도 안전하다: 연결은 건너뛰고 빌드만 다시 시작한다
  } else {
    try {
      await cloudflare.request({
        method: 'POST', path: `${base}/builds/workers`, body: {
          script_tag: w.tag,
          git_repository: { provider_type: 'github', provider_account_id: P.ownerId, provider_account_name: P.owner, repo_id: P.repoId, repo_name: P.repo, branch: 'main' },
          production_settings: { build_command: '', deploy_command: 'npx wrangler deploy', build_token_uuid: tokens[0].build_token_uuid, root_directory: '/', path_includes: ['*'], path_excludes: [], build_caching_enabled: true },
          previews_enabled: false,
        },
      });
    } catch (e) {
      return fail('연결', '저장소 연결에 실패했다. GitHub › Settings › Applications › Cloudflare Workers and Pages가 이 저장소를 볼 수 있는지(All repositories) 확인한다.', e);
    }
  }

  const triggers = (await cloudflare.request({ method: 'GET', path: `${base}/builds/workers/${w.tag}/triggers` })).result || [];
  const prod = triggers.find(t => (t.branch_includes || []).includes('main')) || triggers[0];
  if (!prod) return fail('빌드', '연결은 됐지만 빌드 설정을 찾지 못했다. main에 아무 커밋이나 올리면 빌드가 시작된다.');
  const build = (await cloudflare.request({ method: 'POST', path: `${base}/builds/triggers/${prod.trigger_uuid}/builds`, body: { branch: 'main' } })).result;
  const sub = (await cloudflare.request({ method: 'GET', path: `${base}/workers/subdomain` })).result.subdomain;
  return { ...out, ok: true, build_uuid: build?.build_uuid, url: `https://${P.name}.${sub}.workers.dev`, next: '1~2분 뒤 status로 git_build가 success인지 보고 check_site로 검사한다.' };
}

// status: 배포 시각, 예약 작업, 대시보드 편집 암호 유무, Git 자동 배포 최근 결과.
export async function status(P, cloudflare, accountId) {
  const base = `/accounts/${accountId}`;
  const script = `${base}/workers/scripts/${P.name}`;
  const w = (await cloudflare.request({ method: 'GET', path: `${base}/workers/scripts` })).result.find(s => s.id === P.name);
  if (!w) return { name: P.name, exists: false, note: '이 이름의 Worker가 없다.' };

  const out = { name: P.name, exists: true, modified_on: w.modified_on, has_assets: w.has_assets };
  out.crons = (await cloudflare.request({ method: 'GET', path: `${script}/schedules` })).result.schedules.map(s => s.cron);
  const settings = (await cloudflare.request({ method: 'GET', path: `${script}/settings` })).result;
  out.dashboard_secret_set = (settings.bindings || []).some(b => b.name === 'WRITE_TOKEN'); // 사이트에서 정한 암호는 D1에 있다(check_site로 확인)
  try {
    const b = (await cloudflare.request({ method: 'GET', path: `${base}/builds/builds/latest`, query: { external_script_ids: w.tag } })).result?.builds?.[w.tag];
    out.git_build = b
      ? { status: b.status, outcome: b.build_outcome, branch: b.build_trigger_metadata?.branch, commit: b.build_trigger_metadata?.commit_hash, message: b.build_trigger_metadata?.commit_message, created_on: b.created_on }
      : 'Git 연결(Workers Builds) 기록 없음';
  } catch {
    out.git_build = '확인 불가: 커넥터에 Workers CI 읽기 권한이 없다.';
  }
  return out;
}

// deploy(예비): Worker 올리기(web/ 포함), 예약 작업 시각, workers.dev 켜기.
// P.binaries의 값은 base64. 정적 자산 업로드를 MCP로는 못 해서 web/을 모듈로 묶어 올린다(src/lib/bundled_assets.js).
export async function deploy(P, cloudflare, accountId) {
  const script = `/accounts/${accountId}/workers/scripts/${P.name}`;
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(P.metadata)], { type: 'application/json' }));
  for (const [n, c] of Object.entries(P.modules)) form.append(n, new Blob([c], { type: 'application/javascript+module' }), n);
  for (const [n, c] of Object.entries(P.texts)) form.append(n, new Blob([c], { type: 'text/plain' }), n);
  for (const [n, b] of Object.entries(P.binaries)) form.append(n, new Blob([Uint8Array.from(atob(b), ch => ch.charCodeAt(0))], { type: 'application/octet-stream' }), n);

  const up = (await cloudflare.request({ method: 'PUT', path: script, body: form })).result;
  const out = { name: P.name, uploaded: up?.modified_on || true };
  if (P.crons) out.crons = (await cloudflare.request({ method: 'PUT', path: `${script}/schedules`, body: P.crons.map(cron => ({ cron })) })).result.schedules.map(s => s.cron);
  await cloudflare.request({ method: 'POST', path: `${script}/subdomain`, body: { enabled: true, previews_enabled: false } });
  const sub = (await cloudflare.request({ method: 'GET', path: `/accounts/${accountId}/workers/subdomain` })).result.subdomain;
  out.url = `https://${P.name}.${sub}.workers.dev`;
  return out;
}
