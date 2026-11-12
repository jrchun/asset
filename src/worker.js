// Cloudflare Worker 진입점.
// 정적 파일(web/)은 Cloudflare가 먼저 찾아 보내고, 맞는 파일이 없을 때만 이 코드가 실행된다.
// /api/* 만 여기서 처리하고 나머지는 정적 파일 처리(404 포함)에 넘긴다.
// 새 API: src/api/<이름>.js에 GET/PUT/POST/DELETE 함수를 만들고 아래 ROUTES에 한 줄 추가한다.
// 예약 작업(매일 등)은 src/jobs.js. 시각은 wrangler.toml의 [triggers] crons.
import * as doc from './api/doc.js';
import * as health from './api/health.js';
import * as prices from './api/prices.js';
import * as refresh from './api/refresh.js';
import * as trades from './api/trades.js';
import * as snapshots from './api/snapshots.js';
import { json } from './lib/http.js';
import { runScheduled } from './jobs.js';

// /api/doc 이 포트폴리오 문서다(불러오기·자동 저장·409 충돌은 web/js/docsync.js).
const ROUTES = {
  '/api/doc': doc,
  '/api/health': health,
  '/api/prices': prices,
  '/api/prices/refresh': refresh,
  '/api/trades': { GET: trades.GET },
  '/api/trades/apply': { POST: trades.apply },
  '/api/trades/undo': { POST: trades.undo },
  '/api/snapshots': snapshots,
};

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    const route = ROUTES[path];
    if (!route || (route !== health && !env.DB)) return env.ASSETS.fetch(request);
    const handler = route[request.method];
    if (!handler) return json({ detail: '허용하지 않는 요청 방식입니다.' }, 405);
    try {
      return await handler({ request, env, ctx });
    } catch (e) {
      return json({ detail: '서버 오류: ' + (e && e.message || e) }, 500);
    }
  },
  // Cron Trigger. 결과와 오류는 대시보드 › Worker › 로그에서 본다.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env).then(note => console.log('예약 작업 완료:', note)));
  },
};
