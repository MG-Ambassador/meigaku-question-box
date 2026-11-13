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
  it('ごみ箱を空にすると、ごみ箱のルームと質問・お気に入り・集計だけが消え、責任者以外は実行できない', async () => {
    const now = Timestamp.now();
    const ev = { title: 't', date: '', open: false, version: 2, createdAt: now, updatedAt: now, updatedBy: 'x', schemaVersion: 1 };
    records.set('events/trashed', { ...ev, status: 'deleted' });
    records.set('events/kept', { ...ev, status: 'archived' });
    records.set('eventStats/trashed', { total: 1 });
    records.set('questions/q1', { eventId: 'trashed', body: 'a' });
    records.set('questions/q2', { eventId: 'kept', body: 'b' });
    records.set('userFavorites/owner_q1', { eventId: 'trashed', questionId: 'q1' });

    const member = (await login('member', MEMBER_PASSWORD)).body.token;
    assert.equal((await call('/api/admin/trash/empty', { token: member, body: {} })).status, 403);
    assert.ok(records.has('events/trashed'));

    const owner = (await login('owner', OWNER_PASSWORD)).body.token;
    const res = await call('/api/admin/trash/empty', { token: owner, body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.deletedEvents, 1);
    assert.equal(res.body.deletedQuestions, 1);
    for (const key of ['events/trashed', 'eventStats/trashed', 'questions/q1', 'userFavorites/owner_q1']) assert.ok(!records.has(key), key);
    for (const key of ['events/kept', 'questions/q2']) assert.ok(records.has(key), key);
    const audit = [...records.entries()].filter(([key]) => key.startsWith('audit/')).map(([, v]) => v.action);
    assert.deepEqual(audit, ['event_purge']);
  });
  it('5つのロールは権限表どおりに操作できる（スタッフは受付の切り替えだけ）', async () => {
    const now = Timestamp.now();
    const base = { active: true, mustChange: false, version: 1, createdAt: now, updatedAt: now };
    for (const role of ['developer', 'faculty', 'ambassador', 'staff']) {
      records.set(`operators/${role}`, { ...base, loginId: role, displayName: role, role, passwordHash: memberHash });
    }
    const ev = { title: 't', date: '', open: false, status: 'active', createdAt: now, updatedAt: now, updatedBy: 'x', schemaVersion: 1 };
    const token = async (id: string) => (await login(id, MEMBER_PASSWORD)).body.token as string;
    const staff = await token('staff');
    const faculty = await token('faculty');
    const developer = await token('developer');

    // スタッフ：受付の開閉はできるが、タイトル変更・作成・アーカイブ・ごみ箱・アカウント管理はできない
    records.set('events/r1', { ...ev, version: 1 });
    const toggle = await call('/api/events/r1', { method: 'PATCH', token: staff, body: { title: 't', date: '', open: true, version: 1 } });
    assert.equal(toggle.status, 200);
    assert.equal(toggle.body.open, 1);
    assert.equal((await call('/api/events/r1', { method: 'PATCH', token: staff, body: { title: '別名', open: true, version: 2 } })).status, 403);
    assert.equal((await call('/api/events', { token: staff, body: { title: '新規', open: false } })).status, 403);
    assert.equal((await call('/api/events/r1/lifecycle', { token: staff, body: { action: 'archive', version: 2 } })).status, 403);
    assert.equal((await call('/api/admin/trash/empty', { token: staff, body: {} })).status, 403);
    assert.equal((await call('/api/admin/operators', { token: staff })).status, 403);

    // 教員：ルームの編集・アーカイブはできるが、ごみ箱を空にする・アカウント管理はできない
    assert.equal((await call('/api/events/r1', { method: 'PATCH', token: faculty, body: { title: '別名', version: 2 } })).status, 200);
    assert.equal((await call('/api/events/r1/lifecycle', { token: faculty, body: { action: 'archive', version: 3 } })).status, 200);
    assert.equal((await call('/api/admin/trash/empty', { token: faculty, body: {} })).status, 403);
    assert.equal((await call('/api/admin/operators', { token: faculty })).status, 403);

    // 責任者：教員以下は作れるが、責任者・開発者は作れず、開発者のアカウントも変更できない
    const owner = (await login('owner', OWNER_PASSWORD)).body.token;
    assert.equal((await call('/api/admin/operators', { token: owner, body: { loginId: 'new-staff', displayName: 's', role: 'staff' } })).status, 201);
    assert.equal(records.get('operators/new-staff').role, 'staff');
    assert.equal((await call('/api/admin/operators', { token: owner, body: { loginId: 'new-owner', displayName: 'o', role: 'owner' } })).status, 403);
    assert.equal((await call('/api/admin/operators', { token: owner, body: { loginId: 'new-dev', displayName: 'd', role: 'developer' } })).status, 403);
    assert.equal((await call('/api/admin/operators/developer/disable', { token: owner, body: {} })).status, 403);
    // 旧「担当者」はアンバサダー扱いなので、責任者が管理できる
    assert.equal((await call('/api/admin/operators/member/reset', { token: owner, body: {} })).status, 200);

    // 開発者：責任者も作成・変更できる
    assert.equal((await call('/api/admin/operators', { token: developer, body: { loginId: 'new-owner', displayName: 'o', role: 'owner' } })).status, 201);
    assert.equal((await call('/api/admin/operators/owner/disable', { token: developer, body: {} })).status, 200);
  });
  it('既存アカウントのロールを管理範囲内で変更でき、対象者は再ログインになる', async () => {
    const now = Timestamp.now();
    const base = { active: true, mustChange: false, version: 1, createdAt: now, updatedAt: now, passwordHash: memberHash };
    records.set('operators/developer', { ...base, loginId: 'developer', displayName: 'd', role: 'developer' });
    records.set('operators/staff', { ...base, loginId: 'staff', displayName: 's', role: 'staff' });
    const role = (target: string, token: string, body: unknown) => call(`/api/admin/operators/${target}/role`, { token, body });

    const owner = (await login('owner', OWNER_PASSWORD)).body.token;
    const staff = (await login('staff', MEMBER_PASSWORD)).body.token;

    // 権限のない人・不正な値・自分自身・管理範囲外は拒否
    assert.equal((await role('member', staff, { role: 'faculty' })).status, 403);
    assert.equal((await role('staff', owner, { role: 'boss' })).status, 400);
    assert.equal((await role('owner', owner, { role: 'faculty' })).status, 400);
    assert.equal((await role('staff', owner, { role: 'owner' })).status, 403);
    assert.equal((await role('developer', owner, { role: 'staff' })).status, 403);
    assert.equal((await role('nobody', owner, { role: 'staff' })).status, 404);
    assert.equal(records.get('operators/staff').role, 'staff');

    // 責任者はスタッフを教員に変更できる。対象のセッションは無効になる
    const res = await role('staff', owner, { role: 'faculty' });
    assert.equal(res.status, 200);
    assert.equal(res.body.changed, true);
    assert.equal(records.get('operators/staff').role, 'faculty');
    assert.equal(records.get('operators/staff').version, 2);
    assert.equal((await call('/api/admin/me', { token: staff, method: 'GET' })).status, 401);
    const relogin = await login('staff', MEMBER_PASSWORD);
    assert.equal(relogin.body.user.role, 'faculty');

    // 同じロールへの変更は何もしない
    const same = await role('staff', owner, { role: 'faculty' });
    assert.equal(same.body.changed, false);
    assert.equal(records.get('operators/staff').version, 2);

    // 旧「担当者」もアンバサダー扱いで変更でき、新しい値で保存される
    assert.equal((await role('member', owner, { role: 'staff' })).status, 200);
    assert.equal(records.get('operators/member').role, 'staff');

    // 開発者は責任者を教員に下げられる
    const developer = (await login('developer', MEMBER_PASSWORD)).body.token;
    assert.equal((await role('owner', developer, { role: 'faculty' })).status, 200);
    assert.equal(records.get('operators/owner').role, 'faculty');

    const audit = [...records.entries()].filter(([key]) => key.startsWith('audit/')).map(([, v]) => v.action).sort();
    assert.deepEqual(audit, ['operator_role_ambassador_to_staff', 'operator_role_owner_to_faculty', 'operator_role_staff_to_faculty']);
  });
});
