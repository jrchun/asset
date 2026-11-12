// POST /api/prices/refresh → 가격 수집을 바로 실행하고 { result, prices }를 돌려준다. 편집 암호가 있어야 한다.
import { json, canWrite } from '../lib/http.js';
import { collectPrices, priceDoc } from '../prices/collect.js';

export async function POST({ request, env }) {
  if (!canWrite(request, env)) return json({ detail: '편집 암호가 필요합니다.' }, 401);
  const result = await collectPrices(env);
  return json({ result, prices: await priceDoc(env) });
}
