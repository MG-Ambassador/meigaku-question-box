import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDraft, writeDraft, prepareSubmission, DRAFT_TTL } from '../lib/question-draft.ts';
import { appendReport, newQuestionCount } from '../lib/report-state.ts';
import { apiFetch, getAdminReport, updateAdminEvent, getPublicEvent, ApiError } from '../lib/api-client.ts';
import { getRecruitmentUrl } from '../lib/public-url.ts';

const id = '8a947258-13a6-4c1c-b3f9-12e0f9f72f58';
const storage = () => { const values = new Map(); return { getItem: (k) => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: (k) => values.delete(k) }; };
const draft = () => ({ body: '  大学生活について知りたいです  ', category: '大学生活', savedAt: Date.now() });

test('unknown outcome survives reload with exactly the same payload and source', () => {
  const store = storage(); const original = draft();
  original.pending = prepareSubmission(original, 'event-A', 'instagram', () => id);
  assert.equal(writeDraft(store, 'event-A', original), true);
  const restored = readDraft(store, 'event-A');
  const retry = prepareSubmission(restored, 'event-A', 'web', () => { throw Error('must not create a new id'); });
  assert.deepEqual(retry, original.pending);
  assert.equal(retry.body, original.body.trim());
  assert.throws(() => prepareSubmission({ ...restored, body: '違う質問' }, 'event-A', 'web', () => id));
});
test('drafts are event-specific, expire and can be removed after success', () => {
  const store = storage(); const value = draft();
  writeDraft(store, 'event-A', value);
  assert.equal(readDraft(store, 'event-B').body, '');
  assert.equal(readDraft(store, 'event-A', value.savedAt + DRAFT_TTL + 1).body, '');
  writeDraft(store, 'event-A', value);
  writeDraft(store, 'event-A', { body: '', category: '大学生活', savedAt: Date.now() });
  assert.equal(readDraft(store, 'event-A').body, '');
});
test('corrupt or blocked storage is recoverable', () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  assert.equal(readDraft(blocked, 'A').body, ''); assert.equal(writeDraft(blocked, 'A', draft()), false);
  const store = storage(); store.setItem('mga:draft:v1:A', '{broken');
  assert.equal(readDraft(store, 'A').body, '');
});
test('pagination keeps the snapshot, deduplicates rows and detects new arrivals separately', () => {
  const first = { total: 150, generatedAt: 100, rows: [{ id: '3' }, { id: '2' }], categories: [{ category: '大学生活', count: 150 }], hasNext: true, nextCursor: 'next' };
  const next = { ...first, generatedAt: 200, rows: [{ id: '2' }, { id: '1' }], nextCursor: null, hasNext: false };
  const merged = appendReport(first, next);
  assert.deepEqual(merged.rows.map((r) => r.id), ['3', '2', '1']);
  assert.equal(merged.generatedAt, 100); assert.equal(merged.hasNext, false);
  assert.equal(newQuestionCount(first, { ...first, total: 152 }), 2);
  assert.equal(newQuestionCount(first, { ...first, total: 140 }), 0);
});
test('recruitment URLs keep basePath and only tag explicit Instagram links', () => {
  const old = process.env.NEXT_PUBLIC_BASE_PATH; process.env.NEXT_PUBLIC_BASE_PATH = '/question-box/';
  try {
    assert.equal(getRecruitmentUrl('a&b'), '/question-box/?room=a%26b');
    assert.equal(getRecruitmentUrl('a&b', 'instagram'), '/question-box/?room=a%26b&from=instagram');
  } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = old; }
});
test('API client passes opaque cursor, auth and optimistic version; does not cache', async () => {
  const oldFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true }); };
  try {
    await getAdminReport('token', 'event A', 50, 'opaque+/=');
    assert.equal(new URL(calls[0].url, 'https://example.test').searchParams.get('cursor'), 'opaque+/=');
    assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer token');
    assert.equal(calls[0].options.cache, 'no-store');
    await updateAdminEvent('token', 'a/b', { title: 'new', date: '', open: false, version: 3 });
    assert.match(calls[1].url, /a%2Fb$/); assert.equal(calls[1].options.method, 'PATCH');
    assert.equal(JSON.parse(calls[1].options.body).version, 3);
    await getPublicEvent('closed'); assert.match(calls[2].url, /events\/closed$/);
  } finally { globalThis.fetch = oldFetch; }
});
test('API client preserves Retry-After and aborts stalled requests', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { code: 'RATE_LIMITED', message: 'wait' } }, { status: 429, headers: { 'Retry-After': '23' } });
    await assert.rejects(apiFetch('/test'), (e) => e instanceof ApiError && e.retryAfterSeconds === 23);
    globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    await assert.rejects(apiFetch('/test', { timeoutMs: 5 }), { name: 'TimeoutError' });
    const controller = new AbortController(); const promise = apiFetch('/test', { signal: controller.signal }); controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
  } finally { globalThis.fetch = oldFetch; }
});
