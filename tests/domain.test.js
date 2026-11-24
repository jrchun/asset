// 내 도메인 주소(<앱이름>.<내 도메인>): CLAUDE.md 읽기, wrangler.toml 채우기, MCP에서 도는 domain()을 가짜 Cloudflare로.
// app_starter·hub·asset에 같은 파일을 둔다(저장소마다 다른 값에 기대지 않는다). 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseDomainLine, appHost, setDomainToml, parseToml, renderRemote, DOMAIN_RE } from '../scripts/cf_mcp.mjs';
import * as remote from '../scripts/cf_mcp/remote.js';

const ACC = 'acc1';
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
const ZONE = { id: 'z1', name: 'woongstudio.com', status: 'active', account: { id: ACC } };

test('CLAUDE.md의 "내 도메인:" 줄 읽기', () => {
  assert.equal(parseDomainLine('# 규칙\n\n내 도메인: woongstudio.com\n- 설명'), 'woongstudio.com');
  assert.equal(parseDomainLine('내 도메인: https://WoongStudio.com/'), 'woongstudio.com');
  assert.equal(parseDomainLine('내 도메인: (아직 없음)'), null);
  assert.equal(parseDomainLine('허브 주소: https://hub.x.com'), null);
  assert.equal(parseDomainLine(''), null);
  assert.ok(DOMAIN_RE.test('my-site.co.kr'));
  assert.ok(!DOMAIN_RE.test('nodot'));
  assert.equal(appHost('gym-log', 'woongstudio.com'), 'gym-log.woongstudio.com');
  assert.equal(appHost('gym-log', null), null);
});

test('wrangler.toml: 주소 칸을 넣고, 바꾸고, 지운다. workers.dev는 켜 둔다', () => {
  const src = 'name = "gym-log"\nmain = "./src/worker.js"\ncompatibility_date = "2026-11-01"\n\n[assets]\ndirectory = "./web"\n\n[triggers]\ncrons = ["30 22 * * *"]\n';
  const a = setDomainToml(src, 'gym-log.woongstudio.com');
  const t = parseToml(a);
  assert.equal(t.top.workers_dev, true); // routes가 있으면 Cloudflare가 workers.dev를 끄므로 꼭 넣는다
  assert.deepEqual(t.arrays.routes, [{ pattern: 'gym-log.woongstudio.com', custom_domain: true }]);
  assert.deepEqual(t.tables.triggers.crons, ['30 22 * * *']); // 다른 표는 그대로

  const b = setDomainToml(a, 'new.woongstudio.com'); // 다시 실행하면 칸 하나만 남는다
  assert.deepEqual(parseToml(b).arrays.routes, [{ pattern: 'new.woongstudio.com', custom_domain: true }]);
  assert.equal(b.match(/workers_dev/g).length, 1);
  assert.equal(setDomainToml(b, 'new.woongstudio.com'), b);

  const c = setDomainToml(b, null); // 도메인을 빼면 칸이 사라진다(workers_dev = true는 남아도 무해)
  assert.equal(parseToml(c).arrays.routes, undefined);
  assert.equal(setDomainToml(src, null), src);
});

test('domain(): Worker가 있으면 붙이고, 이미 붙었으면 건너뛴다', async () => {
  const cf = fakeCloudflare({
    'GET /zones': ({ query }) => (query.name === 'woongstudio.com' ? [ZONE] : []),
    'GET /workers/domains': [],
    'GET /workers/scripts': [{ id: 'gym-log' }],
    'PUT /workers/domains': ({ body }) => ({ id: 'd1', ...body }),
  });
  const r = await remote.domain({ name: 'gym-log', host: 'gym-log.woongstudio.com' }, cf, ACC);
  assert.deepEqual([r.ok, r.attached, r.zone, r.url], [true, true, 'woongstudio.com', 'https://gym-log.woongstudio.com']);
  assert.deepEqual(writes(cf)[0].body, { hostname: 'gym-log.woongstudio.com', service: 'gym-log', zone_id: 'z1', enabled: true });

  const again = fakeCloudflare({ 'GET /zones': [ZONE], 'GET /workers/domains': [{ hostname: 'gym-log.woongstudio.com', service: 'gym-log' }] });
  const r2 = await remote.domain({ name: 'gym-log', host: 'gym-log.woongstudio.com' }, again, ACC);
  assert.deepEqual([r2.ok, r2.already, writes(again).length], [true, true, 0]);
});

test('domain(): 도메인이 없거나·준비 중이거나·다른 앱이 쓰면 붙이지 않고 이유를 말한다', async () => {
  const none = await remote.domain({ name: 'a', host: 'a.nope.com' }, fakeCloudflare({ 'GET /zones': [] }), ACC);
  assert.deepEqual([none.ok, none.step], [false, '도메인']);

  const pending = await remote.domain({ name: 'a', host: 'a.woongstudio.com' }, fakeCloudflare({ 'GET /zones': [{ ...ZONE, status: 'pending' }] }), ACC);
  assert.match(pending.note, /pending/);

  const other = fakeCloudflare({ 'GET /zones': [ZONE], 'GET /workers/domains': [{ hostname: 'a.woongstudio.com', service: 'b' }] });
  const o = await remote.domain({ name: 'a', host: 'a.woongstudio.com' }, other, ACC);
  assert.deepEqual([o.ok, o.step, writes(other).length], [false, '겹침', 0]);

  const noWorker = fakeCloudflare({ 'GET /zones': [ZONE], 'GET /workers/domains': [], 'GET /workers/scripts': [] });
  const n = await remote.domain({ name: 'a', host: 'a.woongstudio.com' }, noWorker, ACC);
  assert.deepEqual([n.ok, n.attached, writes(noWorker).length], [true, false, 0]); // 첫 배포 때 [[routes]]로 붙는다

  const cname = fakeCloudflare({ 'GET /zones': [ZONE], 'GET /workers/domains': [], 'GET /workers/scripts': [{ id: 'a' }], 'PUT /workers/domains': new Error('HTTP 409 CNAME') });
  const c = await remote.domain({ name: 'a', host: 'a.woongstudio.com' }, cname, ACC);
  assert.deepEqual([c.ok, c.step], [false, '붙이기']);
  assert.match(c.error, /CNAME/);
});

test('주소 알려 주기: 내 도메인이 있으면 그 주소가 대표, workers.dev는 예비', async () => {
  const cf = fakeCloudflare({ 'GET /workers/subdomain': { subdomain: 'me' }, 'GET /workers/scripts': [] });
  const a = await remote.address({ name: 'gym-log', proposals: [], host: 'gym-log.woongstudio.com' }, cf, ACC);
  assert.deepEqual([a.url, a.workers_dev_url], ['https://gym-log.woongstudio.com', 'https://gym-log.me.workers.dev']);
  const b = await remote.address({ name: 'gym-log', proposals: [], host: null }, cf, ACC);
  assert.equal(b.url, 'https://gym-log.me.workers.dev');

  const code = renderRemote('domain', { name: 'gym-log', host: 'gym-log.woongstudio.com' });
  assert.doesNotThrow(() => new vm.Script('(' + code + ')'));
});
