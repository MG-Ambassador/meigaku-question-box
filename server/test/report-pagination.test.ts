import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import type { Request, Response } from 'express';
import { setFirestore } from '../src/firestore.js';
import { getAdminReportHandler } from '../src/report.js';

function fixture(initial: number) {
  const state = { total: initial, version: 1, afterStats: () => {} };
  const fake = {
    collection(name: string) {
      if (name === 'eventStats') return { doc: () => ({ get: async () => {
        const stats = { total: state.total, lastSequence: state.total, dataVersion: state.version, categories: { '大学生活': state.total }, sources: { web: state.total }, recentDays: {} };
        state.afterStats(); return { exists: true, data: () => stats };
      } }) };
      const predicates: ((value: number) => boolean)[] = [];
      let limit = 50;
      const query = {
        where(field: string, op: string, value: number) {
          if (field === 'sequence') predicates.push((n) => op === '<' ? n < value : n <= value);
          return query;
        },
        orderBy() { return query; },
        limit(n: number) { limit = n; return query; },
        async get() {
          const numbers = Array.from({ length: state.total }, (_, i) => state.total - i).filter((n) => predicates.every((p) => p(n))).slice(0, limit);
          return { docs: numbers.map((n) => ({ id: `q-${n}`, data: () => ({ sequence: n, body: `質問${n}`, category: '大学生活', source: 'web', createdAt: { toMillis: () => 1000 + n } }) })) };
        },
      };
      return query;
    },
  };
  setFirestore(fake as unknown as Firestore);
  return state;
}
async function report(cursor?: string) {
  let status = 200;
  let body: any;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; } };
  await getAdminReportHandler({ query: { event: 'test', pageSize: '50', ...(cursor ? { cursor } : {}) } } as unknown as Request, res as unknown as Response);
  return { status, body };
}
afterEach(() => setFirestore(null));

test('150-row snapshot remains complete and stable while new questions arrive', async () => {
  const state = fixture(150);
  const first = await report(); state.total = 153;
  const second = await report(first.body.nextCursor);
  const third = await report(second.body.nextCursor);
  assert.equal(first.status, 200); assert.equal(second.body.total, 150); assert.equal(third.body.total, 150);
  const ids = [first, second, third].flatMap(({ body }) => body.rows.map((q: { id: string }) => q.id));
  assert.equal(ids.length, 150); assert.equal(new Set(ids).size, 150);
  assert.equal(ids[0], 'q-150'); assert.equal(ids.at(-1), 'q-1'); assert.equal(third.body.hasNext, false);
  assert.equal((await report()).body.total, 153);
});
test('an arrival after a zero-count stats read is deferred to the next snapshot', async () => {
  const state = fixture(0); state.afterStats = () => { state.total = 1; };
  const first = await report();
  assert.equal(first.body.total, 0); assert.deepEqual(first.body.rows, []);
  assert.equal((await report()).body.rows.length, 1);
});
test('a maintenance version change rejects a previously issued cursor', async () => {
  const state = fixture(51); const first = await report(); state.version++;
  const second = await report(first.body.nextCursor);
  assert.equal(second.status, 409); assert.equal(second.body.error.code, 'CURSOR_EXPIRED');
});
