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

-- ===== 리밸런싱 보드 =====
-- 포트폴리오 문서는 위의 doc 표(id=1)에 JSON 하나로 저장한다.

-- 종목별 일별 종가(예약 작업과 [가격 새로고침]이 채운다). currency: KRW | USD
CREATE TABLE IF NOT EXISTS quotes (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (ticker, date)
);

-- 일별 USD/KRW 환율.
CREATE TABLE IF NOT EXISTS fx (
  date TEXT PRIMARY KEY,
  usdkrw REAL NOT NULL,
  source TEXT NOT NULL
);

-- 체결 기록. batch는 한 번의 [반영]으로 들어간 묶음(되돌리기 단위). kind: monthly | annual | manual
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch INTEGER NOT NULL,
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fx REAL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_batch ON trades (batch);

-- 체결 반영 묶음. 되돌리기용으로 반영 직전 문서와 반영 뒤 버전을 남긴다.
CREATE TABLE IF NOT EXISTS trade_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  prev_doc TEXT NOT NULL,
  new_version INTEGER NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);

-- 월말 평가 기록(매월 마지막 날 예약 작업이 남긴다). doc: 그룹·종목별 평가액과 비중 JSON
CREATE TABLE IF NOT EXISTS snapshots (
  date TEXT PRIMARY KEY,
  total REAL NOT NULL,
  doc TEXT NOT NULL
);
