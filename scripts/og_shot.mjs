// 대표 화면(web/og.png)을 찍는다. 앱 허브 카드와 링크 미리보기(카톡 등)에 쓰인다.
// 사용법: node scripts/og_shot.mjs http://localhost:8787   (배포된 주소도 된다)
//   --out <파일>  저장 위치(기본 web/og.png)
// 폰 폭 400px, 라이트 모드, 화면 윗부분(400×640)을 찍는다. 200KB를 넘으면 해상도를 낮춰 다시 찍는다.
// Playwright가 필요하다(클라우드 세션에는 깔려 있다. 내 컴퓨터는 `npm i -g playwright && npx playwright install chromium`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const MAX_BYTES = 200 * 1024;
const args = process.argv.slice(2);
const url = args.find(a => /^https?:\/\//.test(a));
const outIdx = args.indexOf('--out');
const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : 'web/og.png');
if (!url) { console.error('주소를 넣어 주세요. 예: node scripts/og_shot.mjs http://localhost:8787'); process.exit(2); }

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
catch { console.error('Playwright가 없습니다. 내 컴퓨터라면: npm i -g playwright && npx playwright install chromium'); process.exit(2); }

const browser = await chromium.launch();
try {
  let size = 0;
  for (const scale of [2, 1]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 640 }, deviceScaleFactor: scale, colorScheme: 'light' });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200); // 글꼴·첫 데이터가 들어올 시간
    const png = await page.screenshot({ type: 'png' });
    await page.close();
    size = png.length;
    if (size <= MAX_BYTES || scale === 1) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      break;
    }
  }
  const kb = Math.round(size / 1024);
  console.log(`${path.relative(process.cwd(), out)} 저장 (${kb}KB)${size > MAX_BYTES ? ' — 경고: 200KB가 넘음' : ''}`);
} finally {
  await browser.close();
}
