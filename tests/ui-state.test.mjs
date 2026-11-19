import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDraft, writeDraft, prepareSubmission, DRAFT_TTL } from '../lib/question-draft.ts';
import { appendReport, newQuestionCount } from '../lib/report-state.ts';
import { apiFetch, getAdminReport, updateAdminEvent, getPublicEvent, ApiError, login, operatorAction } from '../lib/api-client.ts';
import { readSession, writeSession, clearSession } from '../lib/admin-session.ts';
import { validateNewPassword } from '../lib/password-rules.ts';
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
test('admin session survives reload, expires and recovers from corrupt or blocked storage', () => {
  const s = storage(); const token = 'c'.repeat(64);
  assert.equal(readSession(s), null);
  assert.equal(writeSession({ token, expiresAt: Date.now() + 1000 }, s), true);
  assert.deepEqual(readSession(s)?.token, token);
  assert.equal(readSession(s, Date.now() + 2000), null);
  assert.equal(readSession(s), null, 'expired session is removed');
  s.setItem('mga:admin-session:v1', '{broken'); assert.equal(readSession(s), null);
  s.setItem('mga:admin-session:v1', JSON.stringify({ token: 'not-hex', expiresAt: Date.now() + 1000 })); assert.equal(readSession(s), null);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readSession(blocked), null); assert.equal(writeSession({ token, expiresAt: Date.now() + 1000 }, blocked), false);
  writeSession({ token, expiresAt: Date.now() + 1000 }, s); clearSession(s); assert.equal(readSession(s), null);
});
test('password rules count code points and reject reuse or mismatch', () => {
  assert.match(validateNewPassword('', 'x'.repeat(15), 'x'.repeat(15)), /現在/);
  assert.match(validateNewPassword('old', 'x'.repeat(14), 'x'.repeat(14)), /15〜128/);
  assert.equal(validateNewPassword('old', '😀'.repeat(15), '😀'.repeat(15)), '');
  assert.match(validateNewPassword('x'.repeat(15), 'x'.repeat(15), 'x'.repeat(15)), /異なる/);
  assert.match(validateNewPassword('old', 'x'.repeat(15), 'y'.repeat(15)), /一致/);
});
test('login and operator APIs send credentials only in the body and encode IDs', async () => {
  const oldFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true }); };
  try {
    await login('owner', 'secret pass phrase');
    assert.match(calls[0].url, /\/api\/auth\/login$/); assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.get('Authorization'), null);
    assert.deepEqual(JSON.parse(calls[0].options.body), { loginId: 'owner', password: 'secret pass phrase' });
    await operatorAction('token', 'a/b', 'reset');
    assert.match(calls[1].url, /operators\/a%2Fb\/reset$/); assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer token');
  } finally { globalThis.fetch = oldFetch; }
});
test('client id is a stable UUID per browser and survives blocked storage', async () => {
  const { getClientId, CLIENT_ID_KEY } = await import('../lib/client-id.ts');
  const store = storage();
  const first = getClientId(store, () => '11111111-1111-4111-8111-111111111111');
  assert.equal(first, '11111111-1111-4111-8111-111111111111');
  assert.equal(getClientId(store, () => { throw Error('must reuse the saved id'); }), first);
  store.setItem(CLIENT_ID_KEY, 'broken');
  assert.match(getClientId(store), /^[0-9a-f-]{36}$/);
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const a = getClientId(blocked); const b = getClientId(blocked);
  assert.equal(a, b, 'same id while the page is open even without storage');
});
test('question submission sends the client id with the payload', async () => {
  const { submitQuestion } = await import('../lib/api-client.ts');
  const oldFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true, id: 'x', requestId: id }); };
  try {
    await submitQuestion({ eventId: 'A', body: 'q', category: '大学生活', source: 'web', requestId: id, clientId: '22222222-2222-4222-8222-222222222222' });
    assert.equal(JSON.parse(calls[0].options.body).clientId, '22222222-2222-4222-8222-222222222222');
  } finally { globalThis.fetch = oldFetch; }
});
test('auto refresh prepends only unseen rows, keeps paging position and detects gaps', async () => {
  const { prependNewRows } = await import('../lib/report-state.ts');
  const current = { total: 3, filteredTotal: 3, generatedAt: 100, rows: [{ id: '3' }, { id: '2' }, { id: '1' }], categories: [], sources: [], days: [], hasNext: true, nextCursor: 'older' };
  const fresh = { ...current, total: 5, filteredTotal: 5, generatedAt: 200, rows: [{ id: '5' }, { id: '4' }, { id: '3' }], nextCursor: 'other' };
  const merged = prependNewRows(current, fresh);
  assert.deepEqual(merged.report.rows.map((r) => r.id), ['5', '4', '3', '2', '1']);
  assert.deepEqual(merged.added, ['5', '4']);
  assert.equal(merged.report.total, 5); assert.equal(merged.report.nextCursor, 'older');
  assert.equal(newQuestionCount(merged.report, fresh), 0, 'banner disappears after merge');
  const gap = { ...fresh, rows: [{ id: '60' }, { id: '59' }], hasNext: true };
  assert.equal(prependNewRows(current, gap), null);
  assert.deepEqual(prependNewRows({ ...current, rows: [] }, fresh).report, fresh);
});
