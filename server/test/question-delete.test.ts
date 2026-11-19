import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { setFirestore } from '../src/firestore.js';
import { deleteQuestionHandler } from '../src/report.js';
import { installFakeFirestore } from './fake-firestore.js';

afterEach(() => setFirestore(null));

function seed() {
  const { records } = installFakeFirestore();
  records.set('events/ev', { status: 'active', version: 1 });
  records.set('eventStats/ev', {
    total: 2, lastSequence: 2, dataVersion: 1,
    categories: { '大学生活': 1, '学び・授業': 1 }, sources: { web: 2 }, recentDays: { '2026-11-19': 2 },
  });
  records.set('questions/q1', { eventId: 'ev', body: 'A', category: '大学生活', source: 'web', dayJst: '2026-11-19', sequence: 1 });
  records.set('questions/q2', { eventId: 'ev', body: 'B', category: '学び・授業', source: 'web', dayJst: '2026-11-19', sequence: 2 });
  records.set('userFavorites/alice_q1', { sub: 'alice', questionId: 'q1', eventId: 'ev', active: true });
  records.set('userFavorites/bob_q1', { sub: 'bob', questionId: 'q1', eventId: 'ev', active: false });
  return records;
}

async function del(id: string) {
  let status = 200; let body: any;
  const res = { status(n: number) { status = n; return res; }, json(data: any) { body = data; } };
  await deleteQuestionHandler({ params: { id }, adminUser: { sub: 'owner' } } as unknown as Request, res as unknown as Response);
  return { status, body };
}

test('質問を削除すると集計が減り、お気に入りも消え、監査ログが残る', async () => {
  const records = seed();
  const r = await del('q1');
  assert.equal(r.status, 200);
  assert.equal(records.has('questions/q1'), false);
  assert.equal(records.has('questions/q2'), true);
  assert.equal(records.has('userFavorites/alice_q1'), false);
  assert.equal(records.has('userFavorites/bob_q1'), false);
  const stats = records.get('eventStats/ev');
  assert.equal(stats.total, 1);
  assert.equal(stats.lastSequence, 2);
  assert.deepEqual(stats.categories, { '学び・授業': 1 });
  assert.deepEqual(stats.sources, { web: 1 });
  assert.deepEqual(stats.recentDays, { '2026-11-19': 1 });
  // お気に入りに入れていた人のお気に入り一覧カーソルだけ失効する
  const revisions = [...records].filter(([key]) => key.startsWith('favoriteStates/'));
  assert.equal(revisions.length, 1);
  const audit = [...records].filter(([key]) => key.startsWith('audit/')).map(([, v]) => v);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'question_delete');
  assert.equal(audit[0].targetId, 'q1');
});

test('存在しない質問は 404、ごみ箱のルームの質問は削除できない', async () => {
  const records = seed();
  assert.equal((await del('nope')).status, 404);
  records.set('events/ev', { status: 'deleted', version: 2 });
  const r = await del('q2');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'EVENT_DELETED');
  assert.equal(records.has('questions/q2'), true);
});
