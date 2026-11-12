-- D1(SQLite) 스키마. 여러 번 실행해도 안전하다. 표를 추가하면 여기에 적고 다시 적용한다(Cloudflare MCP: node scripts/cf_mcp.mjs prepare, 또는 wrangler d1 execute --remote).

-- 앱 문서 하나(JSON)를 버전과 함께 저장한다. 다른 기기에서 먼저 고쳤으면 저장을 거절(409)한다.
CREATE TABLE IF NOT EXISTS doc (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- 예약 작업 기록(src/jobs.js).
CREATE TABLE IF NOT EXISTS job_log (
  ts TEXT NOT NULL,
  job TEXT NOT NULL,
  note TEXT NOT NULL
);

-- 사용 기록. 편집 암호를 가진 기기에서 열거나 저장했을 때만 남는다(방문자는 세지 않는다).
CREATE TABLE IF NOT EXISTS usage_log (
  ts TEXT NOT NULL,
  event TEXT NOT NULL
);
