# AGENTS.md (Codex 등 AI 에이전트용)

이 저장소는 작은 웹 앱 시작 틀이다. 규칙과 구조는 `CLAUDE.md`, 설치·배포 순서는 **`docs/AGENT_SETUP.md`**를 따른다.
사용자는 개발 지식이 많지 않다. 답변은 한국어로, 쉬운 말로 한다.

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
