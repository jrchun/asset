# 프로젝트 규칙 — 내 리밸런싱 보드 (새 프로젝트 시작 틀 기반)

이 앱: 그룹별 목표 비중 리밸런싱 도구(1인용). 기획 원본은 jrchun/portfolio의 `docs/requests/001-rebalance-board-mvp.md`, `docs/DESIGN.md`, `reference/rebalance-board.html`.
- 계산은 `web/js/rebalance.js`의 순수 함수에만 둔다(Worker도 가져다 쓴다). 바꾸면 `tests/rebalance.test.js`의 테스트 벡터(요청서 6장 경우 1)를 확인한다.
- 가격 수집은 `src/prices/`(시장별 출처는 `sources.js`), 매일 예약 작업(`src/jobs.js`)과 `POST /api/prices/refresh`가 부른다. 증권사 API·키가 필요한 출처는 쓰지 않는다.
- 주문 기능은 만들지 않는다. 화면의 세금 문구는 안내용이며 계산에 넣지 않는다.

## 언어: 항상 한국어 (가장 먼저 지킬 것)
- 이 저장소에서 하는 모든 대화는 **한국어**로 한다. 세션이 새로 시작돼도, 사용자가 짧게 말해도, 영어로 된 도구 출력·오류·문서를 읽은 뒤에도 마찬가지다.
- 진행 알림, 질문, 보고, 오류 설명, 승인 창을 띄우기 전 설명, 커밋 메시지, PR 제목·설명, 코드 주석, 문서까지 모두 한국어로 쓴다.
- 사용자는 개발 지식이 많지 않다. 전문 용어는 처음 나올 때 쉬운 말로 풀어 쓴다. 예: "배포(사이트에 올리기)", "PR(변경을 합쳐 달라는 요청)", "Merge(합치기)".
- 명령어, 파일 이름, 오류 원문은 그대로 두되 무슨 뜻인지 한국어로 덧붙인다.
- 무엇을 할지 먼저 한 줄로 말하고, 끝나면 결과(된 것, 안 된 것, 사람이 할 일)를 말한다.

**새 앱을 만들거나 배포하라는 요청이면 먼저 `docs/AGENT_SETUP.md`를 읽고 그 순서를 따른다.** (Codex 등은 `AGENTS.md`)
Cloudflare·Supabase 연결은 MCP(브라우저 로그인)로 한다. **API 토큰을 만들게 하지 않는다.** 앱마다 사용자 계정의 GitHub 저장소가 있고, `main`에 올리면 Cloudflare가 자동 배포한다.

## 구성
- `web/`: 정적 화면(빌드 없음). Worker 정적 자산으로 그대로 배포된다. `web/js/docsync.js`가 불러오기·자동 저장·충돌(409)·편집 암호(401)를 맡는다. 앱 화면은 `web/js/app.js`.
- `src/worker.js`: `/api/*`만 처리. 새 API는 `src/api/<이름>.js`에 `GET/PUT/POST/DELETE`를 만들고 `ROUTES`에 추가.
- `src/jobs.js`: 예약 작업(매일 등). `wrangler.toml`의 `[triggers] crons`(UTC) 시각에 Worker 안에서 돈다. 토큰·GitHub Actions 없음. 무료 플랜은 계정 전체 Cron 5개.
- `db/schema.sql`: D1 스키마(`CREATE TABLE IF NOT EXISTS`만). 바꾸면 `node scripts/cf_mcp.mjs prepare`로 만든 코드를 Cloudflare MCP `execute`로 실행해 적용.
- `scripts/cf_mcp.mjs`: Cloudflare MCP `execute`에 넘길 코드를 만든다(`prepare`·`fill`·`deploy`·`status`). 순서는 `docs/AGENT_SETUP.md` 5~7.
- Supabase 모드: `supabase/schema.sql`(RLS 필수), `scripts/use_supabase.py`가 `examples/supabase/web`의 로그인 예제로 화면을 바꾸고 `wrangler.toml` `[vars]`에 주소·공개 키를 넣는다. 화면에는 publishable 키만 넣는다.
- `wrangler.toml`: Worker 설정의 기준. 배포 절차와 함정은 `docs/SETUP.md`.

## 지켜야 할 것
- 화면은 빌드 없는 정적 파일. React·번들러·CSS 프레임워크를 들이지 않는다. 외부 스크립트는 글꼴(Google Fonts)만.
- 색은 `web/styles.css`의 CSS 변수만 쓴다. **라이트·다크와 폰 폭 400px을 매번 확인**한다(가로 스크롤 없음).
- 읽기는 누구나, 쓰기는 편집 암호(Worker 비밀 `WRITE_TOKEN`)가 있어야 한다. 편집 암호는 사람이 대시보드에 직접 넣고, 저장소에 올리지 않는다.
- 모르는 외부 API 사양은 추측하지 말고 공식 문서를 확인한다(Cloudflare 문서는 `https://developers.cloudflare.com/<경로>/index.md`로 마크다운을 받을 수 있다).
- 계산·규칙은 DOM에 접근하지 않는 순수 함수로 두고 `tests/`에 테스트를 붙인다.

## 작업 흐름
1. 고친 뒤 `npm test`(node + python 테스트)와 로컬 실행(`npx wrangler@4 dev`, 편집 암호는 `.dev.vars`)으로 확인한다.
2. 고친 것은 PR로 올리고, `npm test` 통과와 화면 확인이 끝나면 **AI가 직접 Merge한다**(사용자가 미리 허락함. 사용자가 "합치기 전에 보여 줘"라고 했거나 데이터를 지우거나 바꾸는 변경이면 PR 링크를 주고 기다린다). `main`에 들어가면 Cloudflare(Workers Builds)가 1~2분 안에 자동 배포한다(이 앱은 이미 연결돼 있다). 배포 뒤 **반드시** `node scripts/check_site.mjs <사이트 주소>`로 실제 사이트를 확인하고, 화면은 브라우저로 폰 폭에서 본다. "배포했습니다"로 끝내지 않는다.
3. 사람에게 맡겨야 하는 일(Git 연결, 편집 암호, Supabase 설정 클릭)은 `docs/AGENT_SETUP.md`·`docs/SETUP.md`의 해당 줄과 함정을 그대로 안내한다.

## 실행
- 로컬: `cp .dev.vars.example .dev.vars && npx wrangler@4 d1 execute <이름> --local --file db/schema.sql && npx wrangler@4 dev` (예약 작업 시험: `--test-scheduled` 후 `/__scheduled`)
- 테스트: `npm test`
- 배포 확인: `npm run check -- https://<이름>.<계정>.workers.dev`
- Cloudflare 준비·배포: `node scripts/cf_mcp.mjs prepare --name <이름>` → 생긴 `.wrangler/mcp/prepare.js`를 MCP `execute`로 → `fill` → `deploy`
