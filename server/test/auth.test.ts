import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { Timestamp } from '@google-cloud/firestore';
import { createApp } from '../src/app.js';
import { setFirestore } from '../src/firestore.js';
import { hashPassword } from '../src/password.js';
import { hashToken } from '../src/sessions.js';
import { installFakeFirestore } from './fake-firestore.js';

const OWNER_PASSWORD = 'owner pass phrase 123';
const MEMBER_PASSWORD = 'member pass phrase 456';

describe('運営ID・パスワード認証', () => {
  let server: Server;
  let baseUrl: string;
  let records: Map<string, any>;
  let ownerHash: string;
  let memberHash: string;

  before(async () => {
    (process.env as any).NODE_ENV = 'test';
    process.env.RATE_LIMIT_SECRET = 'test-secret';
    ownerHash = await hashPassword(OWNER_PASSWORD);
    memberHash = await hashPassword(MEMBER_PASSWORD);
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  beforeEach(() => {
    records = installFakeFirestore().records;
    const now = Timestamp.now();
    const base = { active: true, mustChange: false, version: 1, createdAt: now, updatedAt: now };
    records.set('operators/owner', { ...base, loginId: 'owner', displayName: '責任者', role: 'owner', passwordHash: ownerHash });
    records.set('operators/member', { ...base, loginId: 'member', displayName: '担当者', role: 'operator', passwordHash: memberHash });
  });

  after(async () => {
    setFirestore(null);
    (server as any).closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  }
  const login = (loginId: string, password: string) => call('/api/auth/login', { body: { loginId, password } });

  it('正しいIDとパスワードでセッションを発行し、DBにはトークンのハッシュだけを保存する', async () => {
    const res = await login('Owner', OWNER_PASSWORD);
    assert.equal(res.status, 200);
    assert.match(res.body.token, /^[a-f0-9]{64}$/);
    assert.ok(res.body.expiresAt > Date.now());
    assert.deepEqual(res.body.user, { sub: 'owner', loginId: 'owner', displayName: '責任者', role: 'owner', mustChange: false });
    assert.ok(records.has(`operatorSessions/${hashToken(res.body.token)}`));
    assert.ok(![...records.keys()].some((key) => key.includes(res.body.token)));

    const me = await call('/api/admin/me', { token: res.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'owner');
  });

  it('未登録ID・誤パスワード・利用停止・不正形式のIDは同じ 401 になる', async () => {
    records.set('operators/member', { ...records.get('operators/member'), active: false });
    const results = await Promise.all([
      login('nobody', OWNER_PASSWORD),
      login('owner', 'wrong pass phrase 000'),
      login('member', MEMBER_PASSWORD),
      login('../owner', OWNER_PASSWORD),
    ]);
    for (const res of results) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(res.body.error.message, results[0].body.error.message);
    }
  });

  it('同じIDへの試行は15分10回で 429 と Retry-After を返す', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login('owner', `wrong pass phrase ${i}`)).status, 401);
    const blocked = await login('owner', OWNER_PASSWORD);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // 別IDは影響を受けない
    assert.equal((await login('member', MEMBER_PASSWORD)).status, 200);
  });

  it('ログアウト・期限切れ・資格情報の変更でセッションは使えなくなる', async () => {
    const a = (await login('owner', OWNER_PASSWORD)).body.token;
    assert.equal((await call('/api/auth/logout', { token: a, body: {} })).status, 200);
    assert.equal((await call('/api/admin/me', { token: a })).status, 401);

    const b = (await login('owner', OWNER_PASSWORD)).body.token;
    const key = `operatorSessions/${hashToken(b)}`;
    records.set(key, { ...records.get(key), expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    assert.equal((await call('/api/admin/me', { token: b })).status, 401);

    const c = (await login('owner', OWNER_PASSWORD)).body.token;
    records.set('operators/owner', { ...records.get('operators/owner'), version: 2 });
    assert.equal((await call('/api/admin/me', { token: c })).status, 401);

    assert.equal((await call('/api/admin/me', { token: 'f'.repeat(64) })).status, 401);
    assert.equal((await call('/api/admin/me', { token: 'not-a-token' })).status, 401);
  });

  it('初回変更前は運営APIを拒否し、変更後は旧トークンを無効にして新トークンを返す', async () => {
    records.set('operators/member', { ...records.get('operators/member'), mustChange: true });
    const first = await login('member', MEMBER_PASSWORD);
    assert.equal(first.body.user.mustChange, true);
    const oldToken = first.body.token;
    const other = (await login('member', MEMBER_PASSWORD)).body.token;

    const blocked = await call('/api/admin/events', { token: oldToken });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await call('/api/admin/me', { token: oldToken })).body.mustChange, true);

    const short = await call('/api/auth/password', { token: oldToken, body: { currentPassword: MEMBER_PASSWORD, newPassword: 'short' } });
    assert.equal(short.status, 400);
    const same = await call('/api/auth/password', { token: oldToken, body: { currentPassword: MEMBER_PASSWORD, newPassword: MEMBER_PASSWORD } });
    assert.equal(same.status, 400);
    const wrong = await call('/api/auth/password', { token: oldToken, body: { currentPassword: 'wrong pass phrase 000', newPassword: 'brand new pass phrase' } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'INVALID_CURRENT_PASSWORD');

    const changed = await call('/api/auth/password', { token: oldToken, body: { currentPassword: MEMBER_PASSWORD, newPassword: 'brand new pass phrase' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.user.mustChange, false);
    assert.notEqual(changed.body.token, oldToken);
    assert.equal((await call('/api/admin/me', { token: oldToken })).status, 401);
    assert.equal((await call('/api/admin/me', { token: other })).status, 401, '他端末もログアウトされる');
    assert.equal((await call('/api/admin/events', { token: changed.body.token })).status, 200);
    assert.equal((await login('member', MEMBER_PASSWORD)).status, 401);
    assert.equal((await login('member', 'brand new pass phrase')).status, 200);
  });

  it('担当者管理は運営責任者だけが使える', async () => {
    const member = (await login('member', MEMBER_PASSWORD)).body.token;
    assert.equal((await call('/api/admin/operators', { token: member })).status, 403);
    assert.equal((await call('/api/admin/operators', { token: member, body: { loginId: 'x-user', displayName: 'X' } })).status, 403);
    assert.equal((await call('/api/admin/operators/owner/disable', { token: member, body: {} })).status, 403);
  });

  it('責任者は担当者を追加・再発行・停止・再開でき、対象のセッションは即時に無効になる', async () => {
    const owner = (await login('owner', OWNER_PASSWORD)).body.token;

    const created = await call('/api/admin/operators', { token: owner, body: { loginId: 'New-Staff', displayName: '新しい担当' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.loginId, 'new-staff');
    assert.match(created.body.temporaryPassword, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(!JSON.stringify(records.get('operators/new-staff')).includes(created.body.temporaryPassword));
    assert.equal((await call('/api/admin/operators', { token: owner, body: { loginId: 'new-staff', displayName: '重複' } })).status, 409);

    const firstLogin = await login('new-staff', created.body.temporaryPassword);
    assert.equal(firstLogin.status, 200);
    assert.equal(firstLogin.body.user.mustChange, true);

    const list = await call('/api/admin/operators', { token: owner });
    assert.deepEqual(list.body.map((o: any) => o.loginId).sort(), ['member', 'new-staff', 'owner']);
    assert.ok(list.body.every((o: any) => !('passwordHash' in o)));

    const memberToken = (await login('member', MEMBER_PASSWORD)).body.token;
    const reset = await call('/api/admin/operators/member/reset', { token: owner, body: {} });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.mustChange, true);
    assert.equal((await call('/api/admin/me', { token: memberToken })).status, 401);
    assert.equal((await login('member', MEMBER_PASSWORD)).status, 401);
    assert.equal((await login('member', reset.body.temporaryPassword)).status, 200);

    assert.equal((await call('/api/admin/operators/member/disable', { token: owner, body: {} })).body.active, false);
    assert.equal((await login('member', reset.body.temporaryPassword)).status, 401);
    assert.equal((await call('/api/admin/operators/member/enable', { token: owner, body: {} })).body.active, true);
    assert.equal((await login('member', reset.body.temporaryPassword)).status, 200);

    const audit = [...records.entries()].filter(([key]) => key.startsWith('audit/')).map(([, v]) => v.action).sort();
    assert.deepEqual(audit, ['operator_create', 'operator_disable', 'operator_enable', 'operator_reset']);
  });

  it('自分自身と他の責任者は管理画面から変更できない', async () => {
    const now = Timestamp.now();
    records.set('operators/owner2', { loginId: 'owner2', displayName: '責任者2', role: 'owner', passwordHash: ownerHash, active: true, mustChange: false, version: 1, createdAt: now, updatedAt: now });
    const owner = (await login('owner', OWNER_PASSWORD)).body.token;
    const self = await call('/api/admin/operators/owner/disable', { token: owner, body: {} });
    assert.equal(self.status, 400);
    assert.equal(self.body.error.code, 'SELF_OPERATION');
    assert.equal((await call('/api/admin/operators/owner2/reset', { token: owner, body: {} })).status, 403);
    assert.equal((await call('/api/admin/operators/nobody/disable', { token: owner, body: {} })).status, 404);
    assert.equal((await call('/api/admin/operators/member/delete', { token: owner, body: {} })).status, 400);
  });
});
