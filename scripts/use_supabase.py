"""이 저장소를 Supabase 모드로 바꾼다(사람마다 로그인하고 자기 데이터만 보는 앱).

  python3 scripts/use_supabase.py --url https://<ref>.supabase.co --key sb_publishable_...

하는 일
  - examples/supabase/web의 예제 화면(로그인 + 내 메모)을 web/에 복사하고 연결 정보를 채운다
  - wrangler.toml에서 D1 연결을 빼고 [vars]에 Supabase 주소·공개 키를 넣는다
    (Worker는 정적 화면과 /api/health, 그리고 매일 Supabase 잠들기 방지 예약 작업(src/jobs.js)을 맡는다)
URL과 키는 공개해도 되는 값이다(publishable). 서비스 키(secret)는 넣지 않는다.
스키마는 supabase/schema.sql. AI는 Supabase MCP(apply_migration)로, 사람은 대시보드 SQL Editor로 적용한다.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "examples" / "supabase"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="https://<ref>.supabase.co")
    ap.add_argument("--key", required=True, help="publishable 키(sb_publishable_...) 또는 legacy anon 키")
    a = ap.parse_args(argv)
    if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co", a.url.rstrip("/")):
        raise SystemExit("URL은 https://<20자 ref>.supabase.co 형식이어야 합니다.")
    if a.key.startswith("sb_secret_") or '"service_role"' in a.key:
        raise SystemExit("서비스 키(secret)는 화면에 넣으면 안 됩니다. publishable 키를 쓰세요.")
    url, key = a.url.rstrip("/"), a.key

    web = ROOT / "web"
    for name in ("js/api.js", "js/docsync.js"):  # D1 모드 전용
        (web / name).unlink(missing_ok=True)
    shutil.copy(EX / "web" / "index.html", web / "index.html")
    shutil.copy(EX / "web" / "vendor-supabase.js", web / "vendor-supabase.js")
    # 라이선스 출처 표시는 저장소 맨 위 THIRD_PARTY_NOTICES.md에 있다(이 파일 맨 위 주석이 그 문서를 가리킨다).
    shutil.copy(EX / "web" / "js" / "app.js", web / "js" / "app.js")
    cfg = (EX / "web" / "js" / "config.js").read_text(encoding="utf-8")
    (web / "js" / "config.js").write_text(cfg.replace("__SUPABASE_URL__", url).replace("__SUPABASE_PUBLISHABLE_KEY__", key), encoding="utf-8")
    css = (web / "styles.css").read_text(encoding="utf-8")
    extra = (EX / "web" / "extra.css").read_text(encoding="utf-8")
    if extra not in css:
        (web / "styles.css").write_text(css.rstrip() + "\n\n" + extra, encoding="utf-8")

    wr = ROOT / "wrangler.toml"
    t = wr.read_text(encoding="utf-8")
    t = re.sub(r"\n\[\[d1_databases\]\]\n(?:[^\n]+\n)*", "\n", t)
    t = re.sub(r"\n# Supabase 연결\(공개 값\).*", "", t, flags=re.S).rstrip() + "\n"
    t += f'\n# Supabase 연결(공개 값). 매일 잠들기 방지 예약 작업(src/jobs.js)이 쓴다.\n[vars]\nSUPABASE_URL = "{url}"\nSUPABASE_KEY = "{key}"\n'
    wr.write_text(t, encoding="utf-8")

    print("Supabase 모드로 바꿨습니다.")
    print(" - web/: 로그인 + 내 메모 예제, web/js/config.js에 연결 정보")
    print(" - wrangler.toml: D1 연결 제거, [vars]에 Supabase 주소·공개 키(매일 잠들기 방지 예약 작업용)")
    print("남은 일: supabase/schema.sql 적용, Supabase에서 이메일 확인(Confirm email) 끄기 — docs/AGENT_SETUP.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
