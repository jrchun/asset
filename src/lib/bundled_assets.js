// MCP 예비 배포 전용(scripts/cf_mcp.mjs deploy). Cloudflare MCP로는 정적 자산 업로드를 할 수 없어서,
// web/ 파일을 Worker 안에 묶고 env.ASSETS.fetch()처럼 돌려준다. wrangler·Git 배포에서는 쓰이지 않는다.
// files: { '/index.html': [내용(문자열 또는 ArrayBuffer), 'text/html; charset=utf-8'], ... }
const notFound = () => new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export function bundledAssets(files) {
  return {
    async fetch(request) {
      let p;
      try { p = decodeURIComponent(new URL(request.url).pathname); } catch { return notFound(); } // 깨진 주소
      if (p.endsWith('/')) p += 'index.html';
      const hit = files[p] || files[p + '.html'] || files[p + '/index.html'];
      if (!hit) return notFound();
      const [body, type] = hit;
      return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
    },
  };
}
