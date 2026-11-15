// scripts/cf_mcp.mjs와 scripts/cf_mcp/remote.js.
// wrangler.toml 읽기·채우기, 묶음 만들기, 그리고 MCP에서 도는 함수를 가짜 Cloudflare로 직접 돌려 본다. 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { parseToml, readConfig, fillToml, collectBundle, renderRemote, subdomainCandidates, toAppName } from '../scripts/cf_mcp.mjs';
import * as remote from '../scripts/cf_mcp/remote.js';
import { bundledAssets } from '../src/lib/bundled_assets.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ACC = 'acc1';

// 가짜 Cloudflare: routes의 키 "METHOD 경로"(경로 앞의 /accounts/acc1은 뺀다)에 맞는 값을 돌려주고, 부른 요청을 기록한다.
// 값이 함수면 요청을 받아 결과를 만들고, Error면 던진다. 없는 경로는 404 오류.
function fakeCloudflare(routes) {
  const calls = [];
  return {
    calls,
    request: async ({ method, path: p, query, body }) => {
      const key = `${method} ${p.replace(`/accounts/${ACC}`, '')}`;
      calls.push({ key, query, body });
      if (!(key in routes)) throw new Error(`HTTP 404 ${key}`);
      const v = typeof routes[key] === 'function' ? routes[key]({ query, body }) : routes[key];
      if (v instanceof Error) throw v;
      return { success: true, result: v };
    },
  };
}
const writes = cf => cf.calls.filter(c => !c.key.startsWith('GET '));

test('wrangler.toml 읽기', () => {
  const c = readConfig(ROOT);
  assert.equal(c.main, './src/worker.js');
  assert.equal(c.assetsDir, './web');
  assert.equal(c.d1.binding, 'DB');
  assert.deepEqual(c.crons, ['30 22 * * *']);
  const t = parseToml('a = "x" # 주석\n[vars]\nK = "v"\n[[d1_databases]]\nid = "1"\n[[d1_databases]]\nid = "2"\n');
  assert.deepEqual(t, { top: { a: 'x' }, tables: { vars: { K: 'v' } }, arrays: { d1_databases: [{ id: '1' }, { id: '2' }] } });
});

test('fill: 이름과 D1 ID만 바꾸고 나머지는 그대로', () => {
  const src = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const out = fillToml(src, { name: 'gym-log', databaseId: 'abc-123' });
  assert.match(out, /^name = "gym-log"$/m);
  assert.match(out, /^database_name = "gym-log"$/m);
  assert.match(out, /^database_id = "abc-123"$/m);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.equal(fillToml('name = "my-app"\nmain = "./src/worker.js"\n', { name: 'x' }), 'name = "x"\nmain = "./src/worker.js"\n');
});

test('이름 규칙: 저장소 이름을 앱 이름으로, 계정 이름 후보', () => {
  assert.equal(toAppName('My_App Starter'), 'my-app-starter');
  assert.equal(toAppName('--a--'), 'a');
  assert.deepEqual(subdomainCandidates('JRchun_X'), ['jrchun-x', 'jrchun-x-apps', 'jrchun-x-app']);
  assert.equal(subdomainCandidates('')[0], 'apps');
});

test('renderRemote: remote.js 함수와 값을 묶은 코드가 문법에 맞고 값을 담는다', () => {
  for (const name of ['address', 'prepare', 'connect', 'status', 'deploy']) {
    const code = renderRemote(name, { name: 'gym-log', proposals: [] });
    assert.doesNotThrow(() => new vm.Script('(' + code + ')'), name);
    assert.match(code, /"name":"gym-log"/);
  }
  assert.throws(() => renderRemote('nope', {}), /nope/);
});

test('renderRemote 코드는 cloudflare와 accountId만으로 실제로 돈다', async () => {
  const cf = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: 'me' }, 'GET /workers/scripts': [] });
  const fn = vm.runInNewContext('(' + renderRemote('address', { name: 'gym-log', proposals: [] }) + ')', { cloudflare: cf, accountId: ACC });
  assert.equal((await fn()).url, 'https://gym-log.me.workers.dev');
});

test('address: 계정 이름이 있으면 그 주소, 없으면 후보. 읽기만 한다', async () => {
  const has = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: 'tedcheon' }, 'GET /workers/scripts': [{ id: 'gym-log' }] });
  const a = await remote.address({ name: 'gym-log', proposals: ['x'] }, has, ACC);
  assert.equal(a.url, 'https://gym-log.tedcheon.workers.dev');
  assert.equal(a.name_taken_in_account, true);
  const none = fakeCloudflare({ 'GET /workers/subdomain': new Error('HTTP 404'), 'GET /workers/scripts': [] });
  const b = await remote.address({ name: 'gym-log', proposals: ['me', 'me-apps'] }, none, ACC);
  assert.equal(b.account_subdomain, null);
  assert.deepEqual(b.proposals.map(p => p.url), ['https://gym-log.me.workers.dev', 'https://gym-log.me-apps.workers.dev']);
  assert.equal(writes(has).length + writes(none).length, 0);
});

test('prepare: D1이 없으면 만들고 스키마 적용, 있으면 그대로 쓴다', async () => {
  const routes = {
    'GET /d1/database': [], 'POST /d1/database': { uuid: 'db-1' }, 'POST /d1/database/db-1/query': [{}, {}],
    'GET /workers/subdomain': { subdomain: 'me' },
  };
  const cf = fakeCloudflare(routes);
  const r = await remote.prepare({ name: 'gym-log', schema: 'S', wantD1: true }, cf, ACC);
  assert.deepEqual([r.d1_created, r.database_id, r.schema_statements, r.url], [true, 'db-1', 2, 'https://gym-log.me.workers.dev']);
  assert.deepEqual(cf.calls.find(c => c.key === 'POST /d1/database').body, { name: 'gym-log', primary_location_hint: 'apac' });

  const again = fakeCloudflare({ ...routes, 'GET /d1/database': [{ name: 'gym-log', uuid: 'db-1' }] });
  assert.equal((await remote.prepare({ name: 'gym-log', schema: 'S', wantD1: true }, again, ACC)).d1_created, false);
  assert.ok(!again.calls.some(c => c.key === 'POST /d1/database'));
});

test('prepare: 계정 이름은 없고 확인받은 이름이 있을 때만 만든다(있으면 절대 안 바꿈)', async () => {
  const exists = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: 'old' } });
  const a = await remote.prepare({ name: 'x', wantD1: false, confirmedSubdomain: 'new' }, exists, ACC);
  assert.equal(a.subdomain, 'old');
  assert.match(a.subdomain_note, /이미 old/);
  assert.equal(writes(exists).length, 0);

  const noneNoConfirm = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: null } });
  const b = await remote.prepare({ name: 'x', wantD1: false, confirmedSubdomain: null }, noneNoConfirm, ACC);
  assert.equal(b.subdomain, null);
  assert.equal(writes(noneNoConfirm).length, 0);

  const create = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: null }, 'PUT /workers/subdomain': ({ body }) => ({ subdomain: body.subdomain }) });
  const c = await remote.prepare({ name: 'x', wantD1: false, confirmedSubdomain: 'me' }, create, ACC);
  assert.deepEqual([c.subdomain, c.subdomain_created, c.url], ['me', true, 'https://x.me.workers.dev']);

  const taken = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: null }, 'PUT /workers/subdomain': new Error('HTTP 409 taken') });
  const d = await remote.prepare({ name: 'x', wantD1: false, confirmedSubdomain: 'me' }, taken, ACC);
  assert.equal(d.subdomain, null);
  assert.match(d.subdomain_error, /409/);
});

const connectP = { name: 'gym-log', owner: 'me', repo: 'gym-log', ownerId: '1', repoId: '2', compatibilityDate: '2026-11-01' };
const connectRoutes = extra => ({
  'GET /builds/tokens': [{ build_token_uuid: 'tok-1' }],
  'GET /workers/scripts': [{ id: 'gym-log', tag: 'tag-1' }],
  'GET /builds/workers/tag-1': new Error('HTTP 404 not connected'),
  'POST /builds/workers': {},
  'GET /builds/workers/tag-1/triggers': [{ trigger_uuid: 'tr-1', branch_includes: ['main'] }],
  'POST /builds/triggers/tr-1/builds': { build_uuid: 'b-1' },
  'GET /workers/subdomain': { subdomain: 'me' },
  ...extra,
});

test('connect: 저장소를 연결하고 첫 빌드를 시작한다(대시보드와 같은 설정)', async () => {
  const cf = fakeCloudflare(connectRoutes());
  const r = await remote.connect(connectP, cf, ACC);
  assert.deepEqual([r.ok, r.build_uuid, r.url], [true, 'b-1', 'https://gym-log.me.workers.dev']);
  const body = cf.calls.find(c => c.key === 'POST /builds/workers').body;
  assert.deepEqual(body.git_repository, { provider_type: 'github', provider_account_id: '1', provider_account_name: 'me', repo_id: '2', repo_name: 'gym-log', branch: 'main' });
  assert.equal(body.production_settings.deploy_command, 'npx wrangler deploy');
  assert.equal(body.production_settings.build_token_uuid, 'tok-1');
  assert.equal(body.previews_enabled, false);
});

test('connect: Worker가 없으면 자리 표시 Worker를 먼저 만든다', async () => {
  let made = false;
  const cf = fakeCloudflare(connectRoutes({
    'GET /workers/scripts': () => (made ? [{ id: 'gym-log', tag: 'tag-1' }] : []),
    'PUT /workers/scripts/gym-log': () => { made = true; return {}; },
    'POST /workers/scripts/gym-log/subdomain': {},
  }));
  const r = await remote.connect(connectP, cf, ACC);
  assert.equal(r.ok, true);
  assert.equal(r.placeholder_created, true);
});

test('connect: 이미 연결돼 있으면 연결은 건너뛰고 빌드만 다시 시작한다', async () => {
  const cf = fakeCloudflare(connectRoutes({ 'GET /builds/workers/tag-1': { git_repository: { repo_name: 'gym-log' } } }));
  const r = await remote.connect(connectP, cf, ACC);
  assert.deepEqual([r.ok, r.already_connected], [true, true]);
  assert.ok(!cf.calls.some(c => c.key === 'POST /builds/workers'));
});

test('connect: 권한·토큰이 없으면 아무것도 만들지 않고 이유를 알려 준다', async () => {
  const noScope = fakeCloudflare(connectRoutes({ 'GET /builds/tokens': new Error('HTTP 403 workers-ci') }));
  const a = await remote.connect(connectP, noScope, ACC);
  assert.deepEqual([a.ok, a.step], [false, '권한']);
  assert.equal(writes(noScope).length, 0);
  const noToken = fakeCloudflare(connectRoutes({ 'GET /builds/tokens': [] }));
  assert.equal((await remote.connect(connectP, noToken, ACC)).step, '배포용 토큰');
  assert.equal(writes(noToken).length, 0);
  const noApp = fakeCloudflare(connectRoutes({ 'POST /builds/workers': new Error('HTTP 400 repo not found') }));
  assert.equal((await remote.connect(connectP, noApp, ACC)).step, '연결');
});

test('status: 예약 작업, 대시보드 암호, 최근 빌드(실제 응답 모양)', async () => {
  const cf = fakeCloudflare({
    'GET /workers/scripts': [{ id: 'gym-log', tag: 'tag-1', modified_on: 't', has_assets: true }],
    'GET /workers/scripts/gym-log/schedules': { schedules: [{ cron: '30 22 * * *' }] },
    'GET /workers/scripts/gym-log/settings': { bindings: [{ name: 'DB' }] },
    'GET /builds/builds/latest': { builds: { 'tag-1': { status: 'stopped', build_outcome: 'success', created_on: 'c', build_trigger_metadata: { branch: 'main', commit_hash: 'abc', commit_message: 'm' } } } },
  });
  const r = await remote.status({ name: 'gym-log' }, cf, ACC);
  assert.deepEqual(r.crons, ['30 22 * * *']);
  assert.equal(r.dashboard_secret_set, false);
  assert.deepEqual(r.git_build, { status: 'stopped', outcome: 'success', branch: 'main', commit: 'abc', message: 'm', created_on: 'c' });
  const missing = fakeCloudflare({ 'GET /workers/scripts': [] });
  assert.equal((await remote.status({ name: 'gym-log' }, missing, ACC)).exists, false);
});

test('deploy(예비): 묶음을 올리고 예약 작업과 workers.dev를 켠다', async () => {
  const cf = fakeCloudflare({
    'PUT /workers/scripts/gym-log': { modified_on: 'now' },
    'PUT /workers/scripts/gym-log/schedules': ({ body }) => ({ schedules: body }),
    'POST /workers/scripts/gym-log/subdomain': {},
    'GET /workers/subdomain': { subdomain: 'me' },
  });
  const P = { name: 'gym-log', metadata: { main_module: 'e.js' }, crons: ['30 22 * * *'], modules: { 'e.js': 'x' }, texts: { '__web/i.html': '<p>' }, binaries: { '__web/a.png': 'iVBORw==' } };
  const r = await remote.deploy(P, cf, ACC);
  assert.deepEqual([r.uploaded, r.crons, r.url], ['now', ['30 22 * * *'], 'https://gym-log.me.workers.dev']);
  const form = cf.calls[0].body;
  assert.deepEqual([...form.keys()], ['metadata', 'e.js', '__web/i.html', '__web/a.png']);
});

test('묶음: Worker 모듈 전부 + web 파일 전부 + 진입 파일', () => {
  const b = collectBundle(ROOT);
  for (const m of ['worker.js', 'jobs.js', 'api/doc.js', 'api/trades.js', 'prices/collect.js', 'lib/http.js', 'lib/bundled_assets.js', '__mcp_entry.js']) assert.ok(b.modules[m], m);
  for (const w of ['index.html', 'styles.css', 'js/app.js']) assert.ok(b.texts['__web/' + w], w);
  const entry = b.modules['__mcp_entry.js'];
  assert.match(entry, /import app from '\.\/worker\.js'/);
  assert.match(entry, /"\/index\.html": \[a\d+, "text\/html; charset=utf-8"\]/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfmcp-'));
  fs.writeFileSync(path.join(dir, 'entry.mjs'), entry);
  execFileSync(process.execPath, ['--check', path.join(dir, 'entry.mjs')]);
});

test('묶음: 그림 등 이진 파일은 base64, 숨은 파일은 뺀다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfmcp-'));
  fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'src/worker.js'), 'export default {}');
  fs.copyFileSync(path.join(ROOT, 'src/lib/bundled_assets.js'), path.join(dir, 'src/lib/bundled_assets.js'));
  fs.writeFileSync(path.join(dir, 'web/icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'web/.assetsignore'), 'x');
  fs.writeFileSync(path.join(dir, 'wrangler.toml'), 'name = "t"\nmain = "./src/worker.js"\n[assets]\ndirectory = "./web"\n');
  const b = collectBundle(dir);
  assert.equal(b.binaries['__web/icon.png'], 'iVBORw==');
  assert.equal(Object.keys(b.texts).length, 0);
  assert.match(b.modules['__mcp_entry.js'], /"\/icon\.png": \[a0, "image\/png"\]/);
});

test('명령줄: 인자가 모자라면 만들지 않고 방법을 알려 준다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfmcp-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: s => !/node_modules|\.git$|\.wrangler/.test(s) });
  fs.writeFileSync(path.join(dir, 'wrangler.toml'), fs.readFileSync(path.join(dir, 'wrangler.toml'), 'utf8').replace('name = "my-app"', 'name = "gym-log"'));
  const run = (...a) => { try { return { out: execFileSync(process.execPath, ['scripts/cf_mcp.mjs', ...a], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { err: e.stderr, out: e.stdout, code: e.status }; } };
  assert.match(run('connect').err, /search\/repositories/);
  assert.match(run('connect', '--github-account-id', '1', '--github-repo-id', '2', '--repo', 'me/gym-log').out, /\.wrangler\/mcp\/connect\.js/);
  assert.doesNotThrow(() => new vm.Script('(' + fs.readFileSync(path.join(dir, '.wrangler/mcp/connect.js'), 'utf8') + ')'));
  const help = run('nope');
  assert.equal(help.code, 2);
  assert.match(help.out, /사용법/);
});

test('bundledAssets: /는 index.html, 없는 주소는 404, 형식 유지, 잘못된 주소도 404', async () => {
  const A = bundledAssets({ '/index.html': ['<h1>hi</h1>', 'text/html; charset=utf-8'], '/a/b.css': ['x{}', 'text/css; charset=utf-8'] });
  const get = async p => A.fetch(new Request('https://x.test' + p));
  const home = await get('/');
  assert.equal(await home.text(), '<h1>hi</h1>');
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await get('/index')).status, 200);
  assert.equal((await get('/a/b.css')).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/%E0%A4%A')).status, 404);
});
