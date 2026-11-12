// GET /api/prices → { asOf, fx, fxDate, quotes: { 종목: { close, date, source, stale } }, lastRun }
import { json } from '../lib/http.js';
import { priceDoc } from '../prices/collect.js';

export async function GET({ env }) {
  return json(await priceDoc(env));
}
