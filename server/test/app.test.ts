import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';

describe('P1 Cloud Run API Server - Integration Tests', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    (process.env as any).NODE_ENV = 'test';
    process.env.ALLOW_TEST_AUTH = 'true';
    process.env.ADMIN_IDENTITIES = JSON.stringify([
      { sub: 'test-admin-sub-123', displayName: 'テスト管理者', email: 'admin@meigaku.example' },
    ]);
    process.env.RATE_LIMIT_SECRET = 'test-secret';

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /health: 200 OK と traceId を返すこと', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as { status: string; timestamp: number };
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.timestamp === 'number');

    const traceId = res.headers.get('x-trace-id');
    assert.ok(traceId && traceId.length > 0);
  });

  it('POST /api/questions: 入力不正時に 400 VALIDATION_ERROR を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 'test-event',
        body: '短すぎ',
        category: '大学生活',
        source: 'web',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
    assert.match(body.error?.message, /5文字以上/);
  });

  it('POST /api/questions: 不正なJSON形式時に 400 INVALID_JSON を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'INVALID_JSON');
  });

  it('POST /api/questions: 8KiB を超えるペイロードで 413 PAYLOAD_TOO_LARGE を返すこと', async () => {
    const hugeBody = 'a'.repeat(9000);
    const res = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: hugeBody }),
    });

    assert.equal(res.status, 413);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'PAYLOAD_TOO_LARGE');
  });

  it('GET /api/admin/me: 認証ヘッダーなしで 401 UNAUTHENTICATED を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'UNAUTHENTICATED');
  });

  it('GET /api/admin/me: 未許可アカウントで 403 FORBIDDEN を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Authorization: 'Bearer test-token-unknown-sub-999' },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
  });

  it('GET /api/admin/me: 許可された管理者で 200 OK と displayName を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Authorization: 'Bearer test-token-test-admin-sub-123' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.displayName, 'テスト管理者');
    assert.equal(body.sub, 'test-admin-sub-123');
  });

  it('GET /api/admin: event パラメータなしで 400 VALIDATION_ERROR を返すこと', async () => {
    const res = await fetch(`${baseUrl}/api/admin`, {
      headers: { Authorization: 'Bearer test-token-test-admin-sub-123' },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
  });

  it('GET /unknown-route: 404 NOT_FOUND を返すこと', async () => {
    const res = await fetch(`${baseUrl}/unknown-path`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as any;
    assert.equal(body.error?.code, 'NOT_FOUND');
  });
});
