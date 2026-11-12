// MCP 배포 전용(scripts/cf_mcp.mjs). Cloudflare MCP로는 정적 자산 업로드를 할 수 없어서,
// web/ 파일을 Worker 안에 묶고 env.ASSETS.fetch()처럼 돌려준다. wrangler·Git 배포에서는 쓰이지 않는다.
// files: { '/index.html': [내용(문자열 또는 ArrayBuffer), 'text/html; charset=utf-8'], ... }
export function bundledAssets(files) {
  return {
    async fetch(request) {
      let p = decodeURIComponent(new URL(request.url).pathname);
      if (p.endsWith('/')) p += 'index.html';
      const hit = files[p] || files[p + '.html'] || files[p + '/index.html'];
      if (!hit) return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      const body = request.method === 'HEAD' ? null : hit[0];
      return new Response(body, { headers: { 'Content-Type': hit[1], 'Cache-Control': 'no-cache' } });
    },
  };
}
