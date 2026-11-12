# AGENTS.md (Codex 등 AI 에이전트용)

이 저장소는 작은 웹 앱 시작 틀이다. 규칙과 구조는 `CLAUDE.md`, 설치·배포 순서는 **`docs/AGENT_SETUP.md`**를 따른다.

## 언어: 항상 한국어 (가장 먼저 지킬 것)
- 이 저장소에서 하는 모든 대화는 **한국어**로 한다. 세션이 새로 시작돼도, 사용자가 짧게 말해도, 영어로 된 도구 출력·오류·문서를 읽은 뒤에도 마찬가지다.
- 진행 알림, 질문, 보고, 오류 설명, 승인 창을 띄우기 전 설명, 커밋 메시지, PR 제목·설명, 코드 주석, 문서까지 모두 한국어로 쓴다.
- 사용자는 개발 지식이 많지 않다. 전문 용어는 처음 나올 때 쉬운 말로 풀어 쓴다. 예: "배포(사이트에 올리기)", "PR(변경을 합쳐 달라는 요청)", "Merge(합치기)".
- 명령어, 파일 이름, 오류 원문은 그대로 두되 무슨 뜻인지 한국어로 덧붙인다.
- 무엇을 할지 먼저 한 줄로 말하고, 끝나면 결과(된 것, 안 된 것, 사람이 할 일)를 말한다.

## Codex에서 서비스 연결 (MCP, 브라우저 로그인)

```
codex mcp add supabase --url https://mcp.supabase.com/mcp
codex mcp login supabase
codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp
codex mcp login cloudflare
```

Codex 안에서 `/mcp`로 연결을 확인한다. API 토큰은 만들지 않는다.
Cloudflare 준비·첫 배포는 `node scripts/cf_mcp.mjs prepare|fill|deploy`가 만든 코드를 Cloudflare MCP `execute`로 실행한다(`docs/AGENT_SETUP.md` 5~6). 이후 배포는 `main`에 올리면 Cloudflare가 한다.
비밀번호(편집 암호)는 채팅으로 받지 않는다.

## 확인 명령

- 테스트: `npm test`
- 로컬 실행: `cp .dev.vars.example .dev.vars && npx wrangler@4 dev`
- 배포 검사: `node scripts/check_site.mjs <사이트 주소>`
