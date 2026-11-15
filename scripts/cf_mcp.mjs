// Cloudflare MCP(https://mcp.cloudflare.com/mcp, 브라우저 로그인)만으로 준비·연결·배포한다. API 토큰이 필요 없다.
// 이 스크립트는 Cloudflare에 직접 접속하지 않는다. MCP의 execute 도구에 넘길 코드를 파일로 만들어 줄 뿐이다.
// AI는 만들어진 파일 내용을 그대로 execute의 code로 넘기고, 돌아온 결과를 읽는다.
// 실제로 Cloudflare에서 도는 코드는 scripts/cf_mcp/remote.js에 있다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as remote from './cf_mcp/remote.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PLACEHOLDER_NAME = 'my-app';
const PLACEHOLDER_ID = '__D1_DATABASE_ID__';
export const MAX_MCP_BYTES = 100 * 1024; // 이보다 크면 AI가 한 번에 넘기기 어렵다

const USAGE = `사용법: node scripts/cf_mcp.mjs <명령> [옵션]   (순서는 docs/AGENT_SETUP.md 2·5·6절)

  address [--name <앱이름>]                    (읽기만) 사이트 주소가 어떻게 될지 → 기획 요약에서 확인받는다
  prepare --name <앱이름> [--subdomain <이름>]  D1 만들기·스키마 적용·주소 확인
                                               (계정 이름이 없을 때만, 확인받은 --subdomain으로 만든다)
  fill --name <앱이름> [--database-id <ID>]     wrangler.toml에 이름과 D1 ID를 채운다(파일만 고침)
  connect --github-account-id <번호> --github-repo-id <번호> [--repo 소유자/이름]
                                               Cloudflare에 저장소를 연결하고 첫 빌드 시작
                                               번호: gh api -X GET search/repositories -f q='repo:소유자/이름' --jq '.items[0] | {repo_id: .id, owner_id: .owner.id}'
  status                                       배포 시각·예약 작업·Git 자동 배포 최근 결과
  deploy                                       (예비) web/을 묶어 Worker를 직접 올린다(작은 앱만)

코드 파일은 .wrangler/mcp/<명령>.js에 생긴다(--out으로 바꿀 수 있음). 계정이 여러 개면 execute에 account_id도 넘긴다.`;

// ── wrangler.toml ─────────────────────────────────────────────

// 이 틀이 쓰는 모양만 읽는다: key = "문자열" | 숫자 | true/false | ["문자열", ...], [표], [[표 배열]].
export function parseToml(text) {
  const out = { top: {}, tables: {}, arrays: {} };
  let cur = out.top;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^\[\[([\w.-]+)\]\]$/))) { (out.arrays[m[1]] ||= []).push(cur = {}); continue; }
    if ((m = line.match(/^\[([\w.-]+)\]$/))) { cur = out.tables[m[1]] ||= {}; continue; }
    if ((m = line.match(/^([\w-]+)\s*=\s*(.+)$/))) cur[m[1]] = parseValue(m[2]);
  }
  return out;
}

function parseValue(v) {
  v = v.trim();
  if (v.startsWith('"') || v.startsWith('[')) return JSON.parse(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return Number(v);
}

export function readConfig(root = ROOT) {
  const cfg = parseToml(fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8'));
  const d1 = (cfg.arrays.d1_databases || [])[0] || null;
  return {
    name: cfg.top.name,
    main: cfg.top.main || './src/worker.js',
    compatibilityDate: cfg.top.compatibility_date,
    compatibilityFlags: cfg.top.compatibility_flags || [],
    assetsDir: cfg.tables.assets?.directory || null,
    d1: d1 && { binding: d1.binding, name: d1.database_name, id: d1.database_id },
    crons: cfg.tables.triggers ? cfg.tables.triggers.crons || [] : null, // null = [triggers] 없음(건드리지 않음)
    vars: cfg.tables.vars || {},
  };
}

// name, database_name, database_id만 바꾼 글을 돌려준다(다른 줄과 주석은 그대로).
export function fillToml(text, { name, databaseId }) {
  const set = (t, key, value) => t.replace(new RegExp(`^(${key}\\s*=\\s*)"[^"]*"`, 'm'), (_, a) => `${a}"${value}"`);
  let t = set(text, 'name', name);
  if (/^\[\[d1_databases\]\]/m.test(t)) {
    t = set(t, 'database_name', name);
    if (databaseId) t = set(t, 'database_id', databaseId);
  }
  return t;
}

// ── 이름·저장소 ───────────────────────────────────────────────

// 저장소 이름 등을 앱 이름(Worker·D1 이름, 주소 앞부분) 규칙에 맞춘다: 영문 소문자·숫자·하이픈.
export function toAppName(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

// workers.dev 계정 이름 후보(처음 쓰는 계정에서만 제안한다). 전 세계에서 겹치면 안 되므로 몇 개를 준비한다.
export function subdomainCandidates(base) {
  const b = toAppName(base).slice(0, 50) || 'apps';
  return [...new Set([b, `${b}-apps`, `${b}-app`])];
}

// 저장소 주인(GitHub 아이디)과 이름. git 원격 주소에서 읽는다.
export function repoFromGit(root = ROOT) {
  try {
    const url = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const [owner, repo] = url.replace(/\.git$/, '').split(/[/:]/).slice(-2);
    return owner && repo ? { owner, repo } : null;
  } catch { return null; }
}

// ── 예비 배포용 묶음 ──────────────────────────────────────────

const TEXT_TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', xml: 'application/xml',
  webmanifest: 'application/manifest+json', map: 'application/json; charset=utf-8',
};
const BINARY_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}
const posix = p => p.split(path.sep).join('/');

// Worker 코드 모듈과 web/ 파일을 묶고, env.ASSETS를 흉내 내는 진입 파일(__mcp_entry.js)을 만든다.
// MCP로는 정적 자산 업로드를 할 수 없어서다(업로드 전용 임시 토큰이 MCP 로그인 정보에 덮어써진다).
export function collectBundle(root = ROOT, config = readConfig(root)) {
  const mainAbs = path.resolve(root, config.main);
  const mainDir = path.dirname(mainAbs);
  const modules = {};
  for (const f of walk(mainDir)) if (/\.m?js$/.test(f)) modules[posix(path.relative(mainDir, f))] = fs.readFileSync(f, 'utf8');
  const mainRel = posix(path.relative(mainDir, mainAbs));
  const helperRel = posix(path.relative(mainDir, path.join(root, 'src/lib/bundled_assets.js')));
  if (!modules[helperRel]) throw new Error('src/lib/bundled_assets.js가 Worker 코드 폴더 안에 없습니다.');

  const texts = {}, binaries = {}, assets = []; // assets: [import 이름, 주소, 모듈 이름, Content-Type]
  if (config.assetsDir) {
    const dir = path.resolve(root, config.assetsDir);
    for (const f of walk(dir)) {
      const rel = posix(path.relative(dir, f));
      if (rel.split('/').some(s => s.startsWith('.'))) continue; // .assetsignore 등 숨은 파일은 올리지 않는다
      const ext = path.extname(f).slice(1).toLowerCase();
      const mod = `__web/${rel}`;
      if (TEXT_TYPES[ext]) texts[mod] = fs.readFileSync(f, 'utf8');
      else binaries[mod] = fs.readFileSync(f).toString('base64');
      assets.push([`a${assets.length}`, '/' + rel, mod, TEXT_TYPES[ext] || BINARY_TYPES[ext] || 'application/octet-stream']);
    }
  }
  modules['__mcp_entry.js'] = [
    '// cf_mcp.mjs가 만든 배포용 진입 파일. web/ 파일을 묶어 env.ASSETS로 넘긴다.',
    `import app from './${mainRel}';`,
    `import { bundledAssets } from './${helperRel}';`,
    ...assets.map(([id, , mod]) => `import ${id} from './${mod}';`),
    'const ASSETS = bundledAssets({',
    ...assets.map(([id, url, , type]) => `  ${JSON.stringify(url)}: [${id}, ${JSON.stringify(type)}],`),
    '});',
    'const withAssets = env => { const e = Object.create(env); e.ASSETS = ASSETS; return e; };',
    'export default {',
    '  fetch: (req, env, ctx) => app.fetch(req, withAssets(env), ctx),',
    '  scheduled: (c, env, ctx) => app.scheduled ? app.scheduled(c, withAssets(env), ctx) : undefined,',
    '};',
    '',
  ].join('\n');
  return { mainModule: '__mcp_entry.js', modules, texts, binaries };
}

// ── MCP execute에 넘길 코드 ───────────────────────────────────

// remote.js의 함수 소스와 넘길 값(P)을 묶는다. 결과는 execute의 code에 그대로 넣는 async 화살표 함수다.
export function renderRemote(name, params) {
  const fn = remote[name];
  if (typeof fn !== 'function') throw new Error(`remote.js에 ${name} 함수가 없습니다.`);
  return `async () => {\n// cf_mcp.mjs ${name}: scripts/cf_mcp/remote.js의 ${name}()을 실행한다\nconst run = ${fn.toString()};\nreturn run(${JSON.stringify(params)}, cloudflare, accountId);\n}\n`;
}

// ── 명령 ──────────────────────────────────────────────────────

function arg(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function need(cond, message) { if (!cond) throw new Error(message); }

const appNameIsSet = config => config.name && config.name !== PLACEHOLDER_NAME;

// 각 명령은 { file?, params? } 또는 { message }를 돌려준다. params가 있으면 remote.js의 같은 이름 함수로 코드를 만든다.
const COMMANDS = {
  address(args, config) {
    const repo = repoFromGit();
    const name = arg(args, '--name') || (appNameIsSet(config) ? config.name : toAppName(repo?.repo));
    need(name && NAME_RE.test(name), '--name <앱이름>을 정해 주세요(영문 소문자·숫자·하이픈).');
    return { params: { name, proposals: subdomainCandidates(repo?.owner) } };
  },

  prepare(args, config) {
    const name = arg(args, '--name') || config.name;
    need(name && name !== PLACEHOLDER_NAME && NAME_RE.test(name), '--name <앱이름>을 정해 주세요(영문 소문자·숫자·하이픈, 예: gym-log).');
    const confirmedSubdomain = arg(args, '--subdomain') || null;
    need(!confirmedSubdomain || NAME_RE.test(confirmedSubdomain), '--subdomain은 영문 소문자·숫자·하이픈만 쓸 수 있습니다.');
    const schema = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
    return { params: { name, schema, wantD1: Boolean(config.d1), confirmedSubdomain } };
  },

  fill(args, config) {
    const name = arg(args, '--name');
    need(name && NAME_RE.test(name), '--name <앱이름>이 필요합니다.');
    const databaseId = arg(args, '--database-id');
    need(!config.d1 || databaseId || config.d1.id !== PLACEHOLDER_ID, 'D1 모드라 --database-id가 필요합니다(prepare 결과의 database_id).');
    const file = path.join(ROOT, 'wrangler.toml');
    fs.writeFileSync(file, fillToml(fs.readFileSync(file, 'utf8'), { name, databaseId }));
    return { message: `wrangler.toml을 채웠습니다: name=${name}${databaseId ? `, database_id=${databaseId}` : ''}. 커밋하세요.` };
  },

  connect(args, config) {
    need(appNameIsSet(config), '먼저 fill로 wrangler.toml의 name을 정하세요.');
    const ownerId = arg(args, '--github-account-id'), repoId = arg(args, '--github-repo-id');
    need(/^\d+$/.test(ownerId || '') && /^\d+$/.test(repoId || ''),
      "--github-account-id와 --github-repo-id(숫자)가 필요합니다: gh api -X GET search/repositories -f q='repo:소유자/이름' --jq '.items[0] | {repo_id: .id, owner_id: .owner.id}'");
    const fromGit = repoFromGit();
    const [owner, repo] = (arg(args, '--repo') || (fromGit ? `${fromGit.owner}/${fromGit.repo}` : '')).split('/');
    need(owner && repo, '--repo 소유자/이름을 정해 주세요.');
    return { params: { name: config.name, owner, repo, ownerId, repoId, compatibilityDate: config.compatibilityDate } };
  },

  status(args, config) {
    need(appNameIsSet(config), '먼저 fill로 wrangler.toml의 name을 정하세요.');
    return { params: { name: config.name } };
  },

  deploy(args, config) {
    need(appNameIsSet(config), '먼저 fill로 wrangler.toml의 name을 정하세요.');
    need(!config.d1 || (config.d1.id && config.d1.id !== PLACEHOLDER_ID), 'wrangler.toml의 database_id가 비어 있습니다. prepare → fill을 먼저 하세요.');
    const bundle = collectBundle(ROOT, config);
    const bindings = [];
    if (config.d1) bindings.push({ type: 'd1', name: config.d1.binding, id: config.d1.id });
    for (const [k, v] of Object.entries(config.vars)) bindings.push({ type: 'plain_text', name: k, text: String(v) });
    const metadata = {
      main_module: bundle.mainModule,
      compatibility_date: config.compatibilityDate,
      ...(config.compatibilityFlags.length ? { compatibility_flags: config.compatibilityFlags } : {}),
      bindings,
      keep_bindings: ['secret_text', 'secret_key'], // 대시보드에서 넣은 비밀(WRITE_TOKEN 등)은 유지
    };
    return { params: { name: config.name, metadata, crons: config.crons, modules: bundle.modules, texts: bundle.texts, binaries: bundle.binaries } };
  },
};

function writeOut(args, cmd, code) {
  const out = arg(args, '--out') || path.join(ROOT, '.wrangler', 'mcp', `${cmd}.js`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, code);
  const bytes = Buffer.byteLength(code);
  console.log(`Cloudflare MCP execute에 넘길 코드: ${path.relative(process.cwd(), out)} (${bytes} bytes)`);
  console.log('이 파일 내용을 그대로 execute의 code로 넘기세요. 계정이 여러 개면 account_id도 함께 넘깁니다.');
  if (bytes > MAX_MCP_BYTES) console.log(`주의: ${Math.round(bytes / 1024)}KB라 MCP로 넘기기에 너무 큽니다. 이 명령 대신 Git 연결(connect)로 배포하세요.`);
}

export function main(args = process.argv.slice(2)) {
  const cmd = args[0];
  const command = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!command) { console.log(USAGE); process.exitCode = 2; return; }
  const result = command(args, readConfig());
  if (result.message) console.log(result.message);
  if (result.params) writeOut(args, cmd, renderRemote(cmd, result.params));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
