# 앱 시작 틀 (app_starter)

나와 친구 몇 명이 쓰는 **작은 웹 앱**을 Claude Code로 만들고, 무료로 인터넷에 올리기 위한 틀입니다.
개발을 몰라도 아래 순서만 따라 하면 됩니다. 코드는 Claude가 쓰고, 사람은 로그인 버튼 몇 번과 편집 암호만 넣습니다.

> 예: 가계부, 운동 기록, 모임 회비 장부, 투자 비중 계산기처럼 "나(와 몇 명)만 쓰는 도구"에 맞습니다.
> 회원가입·결제가 필요한 큰 서비스에는 맞지 않습니다.

---

## 가장 쉬운 방법: AI에게 맡기기

Claude Code나 Codex에 이 저장소 주소와 만들고 싶은 것을 그대로 말하세요.

> https://github.com/jrchun/app_starter 로 운동 기록 앱을 만들어서 배포까지 해 줘. 날짜별로 종목·무게·횟수를 적고 폰에서 주로 쓸 거야.

AI가 [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md)를 읽고 저장소 만들기 → 개발 → 데이터베이스 → 배포 → 실제 사이트 확인까지 진행합니다.
사람이 할 일은 **브라우저 로그인 버튼 누르기(GitHub·Cloudflare·Supabase), Claude가 만든 변경 합치기(Merge), 자동 배포 연결 버튼 한 번, 편집 암호 정하기, AI가 묻는 것에 답하기**뿐입니다. 토큰을 만들 필요는 없습니다.

- 내 컴퓨터에서 Claude Code·Codex를 쓰면 거의 전부 자동입니다.
- claude.ai 웹 같은 클라우드에서 쓰면 저장소 만들기, 변경 합치기(Merge), 자동 배포 연결은 버튼을 직접 눌러야 합니다(아래 "새 앱 만들기").

### 데이터 저장 방식 고르기

| | D1 모드 (기본) | Supabase 모드 |
|---|---|---|
| 이런 앱 | 가계부, 회비 장부처럼 나(와 몇 명)가 **같은 데이터**를 함께 봄 | 운동 인증처럼 **사람마다 로그인**하고 자기 데이터를 봄 |
| 로그인 | 없음. 고치려면 편집 암호 | 이메일·비밀번호 |
| 읽기 | 주소를 아는 누구나 | 본인만 |
| 무료 한도 | 넉넉함 | 계정당 프로젝트 2개 |

모르겠으면 AI에게 앱 설명만 하면 맞는 쪽을 추천합니다.

---

## 준비물 (처음 한 번)

| 필요한 것 | 비용 | 용도 |
|---|---|---|
| GitHub 계정 | 무료 | 코드 보관 |
| Cloudflare 계정 | 무료 | 사이트를 인터넷에 올림 |
| Supabase 계정 (Supabase 모드만) | 무료 | 로그인·사람별 데이터 |
| Claude Code 또는 Codex | 구독 | 코드를 대신 써 줌 |

세 서비스 모두 **본인 계정**을 씁니다. 이 틀을 만든 사람의 계정이나 데이터와는 전혀 연결되지 않습니다.

---

## 새 앱 만들기 (직접 따라 하기)

### 1. 내 저장소 만들기 (1분)

1. 이 페이지 위쪽 초록색 **Use this template** 버튼 › **Create a new repository**
2. Owner는 내 계정, Repository name은 앱 이름을 영문 소문자와 하이픈으로 (예: `gym-log`)
3. Public / Private 아무거나 고르고 **Create repository**

> 버튼이 안 보이면 GitHub에 로그인했는지 확인하세요.

### 2. Claude Code에서 시작하기

1. claude.ai/code에서 새 세션을 열고, 방금 만든 저장소를 고릅니다.
2. 만들고 싶은 것을 평소 말투로 적습니다.

   > 운동 기록 앱을 만들고 싶어. 날짜별로 종목·무게·횟수를 적고, 이번 주 합계를 보여 줘. 폰에서 주로 쓸 거야.

3. Claude가 만들고, 테스트하고, 화면 캡처까지 확인한 뒤 보고합니다. 마음에 안 드는 곳은 그대로 말하면 고칩니다.

### 3. 인터넷에 올리기 (처음 한 번, 10분 정도)

**토큰이나 열쇠 같은 값을 만들 필요가 없습니다.** 각 서비스에 브라우저로 로그인만 하면 Claude가 나머지를 합니다.
사람이 할 일은 아래 다섯 가지이고, **이 순서대로** 합니다. ④는 ②와 ③이 끝난 뒤에 해야 합니다. 자세한 순서와 흔한 실수는 [`docs/SETUP.md`](docs/SETUP.md)에 있습니다.

| # | 할 일 | 어디서 |
|---|---|---|
| ① | (처음 한 번) Cloudflare **로그인 버튼** 누르기. claude.ai는 설정 › 커넥터 › 사용자 지정 커넥터 › `https://mcp.cloudflare.com/mcp` | 브라우저 |
| ② | Claude가 데이터베이스와 사이트를 만들고 주소를 알려 줌. claude.ai에서는 "사이트 주소에 접속하게 해 달라"는 **승인 창**이 한 번 뜨니 허락 | Claude Code |
| ③ | Claude가 준 PR 링크에서 **Merge** 버튼 (변경을 `main`에 합치기) | GitHub |
| ④ | **자동 배포 연결**: Cloudflare › Workers 및 Pages › 내 앱(②에서 Claude가 만든 것) › 설정 › Builds › **Connect** › GitHub › 1에서 만든 저장소. 처음이면 GitHub에서 Cloudflare 앱 설치를 허락 | Cloudflare |
| ⑤ | Worker › 설정 › 변수 및 비밀 › **Secret** `WRITE_TOKEN` = 내가 정한 **편집 암호** | Cloudflare |

끝나면 Claude가 사이트(`https://앱이름.내계정.workers.dev`)를 직접 검사하고 결과를 알려 줍니다.
마지막으로 폰에서 사이트를 열어 아무 값이나 고치고, 편집 암호를 한 번 넣어 **"저장됨"**이 뜨면 완성입니다.

> **꼭 기억할 것**
> - **Pages가 아니라 Workers**입니다. Claude가 만든 Worker에 연결하세요.
> - 편집 암호는 **채팅에 붙여 넣지 마세요.** Cloudflare 설정 화면에만 넣습니다.
> - 매일 자동 작업은 Cloudflare 안에서 돕니다(따로 설정할 것 없음). 무료 플랜은 계정 전체에서 5개 앱까지 매일 작업을 쓸 수 있습니다.

### 4. 그다음부터

- 고치고 싶으면 Claude에게 말하면 됩니다. Claude가 준 PR을 Merge하면 사이트가 자동으로 바뀌고, Claude가 실제 사이트를 확인합니다.
- 사이트 주소를 친구에게 보내면 **누구나 볼 수 있고**, **편집 암호를 아는 사람만 고칠 수 있습니다.**
- 편집 암호는 기기마다 처음 한 번만 넣으면 그 기기에 기억됩니다.

---

## 알아 두면 좋은 것

- **비용**: 작은 개인 앱이면 Cloudflare와 GitHub 무료 범위 안에서 충분합니다.
- **데이터는 공개입니다**: 사이트 주소를 아는 사람은 내용을 볼 수 있습니다. 남에게 보이면 안 되는 정보(주민번호, 계좌 비밀번호 등)는 넣지 마세요.
- **백업**: Claude에게 "데이터 백업해 줘"라고 하면 데이터베이스를 파일로 내려받는 방법을 안내합니다.
- **틀이 좋아지면**: 이 저장소가 바뀌어도 이미 만든 내 앱에는 자동으로 반영되지 않습니다. 필요한 부분만 Claude에게 옮겨 달라고 하세요.

---

## 안에 들어 있는 것 (Claude와 개발자용)

| 역할 | 무엇으로 | 위치 |
|---|---|---|
| 화면 | 정적 HTML·CSS·JS (빌드 없음) | `web/` |
| API | Cloudflare Worker | `src/` |
| 저장 | Cloudflare D1 (SQLite) | `db/schema.sql` |
| 매일 작업 | Cloudflare Cron Trigger | `src/jobs.js`, `wrangler.toml` `[triggers]` |
| 배포 | Cloudflare MCP(첫 배포), Workers Builds(이후 `main` 푸시마다) | `scripts/cf_mcp.mjs` |

- 문서 하나를 저장하는 API(`/api/doc`): 버전 관리, 다른 기기 동시 수정 시 409, 편집 암호 없으면 401
- 화면 동기화 모듈(`web/js/docsync.js`): 0.7초 뒤 자동 저장, 충돌 시 최신으로 교체, 화면 안 편집 암호 입력칸
- 라이트·다크 색 변수, 폰(400px) 기준 레이아웃
- `scripts/cf_mcp.mjs`(Cloudflare MCP로 D1 준비·배포·상태 확인), `scripts/check_site.mjs`(배포 검사), 테스트
- 작업 규칙은 [`CLAUDE.md`](CLAUDE.md), 배포 절차와 함정은 [`docs/SETUP.md`](docs/SETUP.md)
- 포함된 외부 코드(Supabase 브라우저 라이브러리, MIT)의 출처: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

```
npm test                                                  # 테스트
cp .dev.vars.example .dev.vars
npx wrangler@4 d1 execute my-app --local --file db/schema.sql
npx wrangler@4 dev                                        # http://localhost:8787
npm run check -- https://my-app.<계정>.workers.dev        # 배포 검사
```
