// 테스트용 가짜 D1: node:sqlite 메모리 DB에 db/schema.sql을 적용하고 D1과 같은 모양의 API를 준다.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const norm = v => (v === undefined ? null : v);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a.map(norm)),
    async first() { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    async all() { return { results: db.prepare(sql).all(...args).map(r => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    _exec() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    // D1 batch는 한 트랜잭션: 하나라도 실패하면 모두 되돌린다.
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map(s => s._exec()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
