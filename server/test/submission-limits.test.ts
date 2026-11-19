import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { installFakeFirestore } from './fake-firestore.js';
import { setFirestore } from '../src/firestore.js';
import { submitQuestionHandler } from '../src/questions.js';
import { getSubmissionPolicies } from '../src/rate-limit.js';

const ENV_KEYS = ['SUBMISSION_LIMIT_PER_DEVICE', 'SUBMISSION_LIMIT_PER_IP'] as const;

function post(body: Record<string, unknown>, ip = '198.51.100.7') {
  const req = { body, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '10.0.0.1' } } as any;
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    payload: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.payload = data; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return submitQuestionHandler(req, res).then(() => res);
}

function question(clientId?: string) {
  return {
    eventId: 'room-1',
    body: '学食はだれでも使えますか？',
    category: '大学生活',
    source: 'web',
    requestId: crypto.randomUUID(),
    ...(clientId ? { clientId } : {}),
  };
}

describe('質問投稿の制限（端末ごと・回線ごと）', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
    const { records } = installFakeFirestore();
    const now = Timestamp.now();
    records.set('events/room-1', {
      title: 'テスト', date: '', open: true, status: 'active', version: 1,
      createdAt: now, updatedAt: now, updatedBy: 'test', schemaVersion: 1,
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    setFirestore(null);
  });

  it('既定値は端末ごと10分5件、回線ごと10分300件', () => {
    const { device, ip } = getSubmissionPolicies();
    assert.deepEqual(device, { windowSeconds: 600, max: 5 });
    assert.deepEqual(ip, { windowSeconds: 600, max: 300 });
  });

  it('環境変数で変更でき、0 で制限をなくし、不正な値は既定値に戻す', () => {
    process.env.SUBMISSION_LIMIT_PER_DEVICE = '0';
    process.env.SUBMISSION_LIMIT_PER_IP = '1000';
    assert.equal(getSubmissionPolicies().device, null);
    assert.equal(getSubmissionPolicies().ip?.max, 1000);
    process.env.SUBMISSION_LIMIT_PER_IP = 'abc';
    assert.equal(getSubmissionPolicies().ip?.max, 300);
  });

  it('同じ回線（会場 Wi-Fi）でも、端末が違えばそれぞれ5件まで送れる', async () => {
    for (let device = 0; device < 4; device += 1) {
      const clientId = crypto.randomUUID();
      for (let i = 0; i < 5; i += 1) {
        const res = await post(question(clientId));
        assert.equal(res.statusCode, 201, `端末${device} の ${i + 1} 件目`);
      }
    }
  });

  it('同じ端末の6件目は、回線が変わっても 429 と待ち時間を返す', async () => {
    const clientId = crypto.randomUUID();
    for (let i = 0; i < 5; i += 1) assert.equal((await post(question(clientId))).statusCode, 201);
    const res = await post(question(clientId), '203.0.113.50');
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.error.code, 'RATE_LIMITED');
    assert.ok(Number(res.headers['Retry-After']) > 0);
  });

  it('回線ごとの上限を超えると、別の端末でも 429 になる', async () => {
    process.env.SUBMISSION_LIMIT_PER_IP = '3';
    for (let i = 0; i < 3; i += 1) assert.equal((await post(question(crypto.randomUUID()))).statusCode, 201);
    assert.equal((await post(question(crypto.randomUUID()))).statusCode, 429);
    assert.equal((await post(question(crypto.randomUUID()), '192.0.2.10')).statusCode, 201, '別の回線は影響を受けない');
  });

  it('端末IDを送らない古い画面は、回線ごとの上限だけで判定する', async () => {
    for (let i = 0; i < 6; i += 1) assert.equal((await post(question())).statusCode, 201);
  });

  it('同じ requestId の再送は投稿枠を使わない', async () => {
    const clientId = crypto.randomUUID();
    const first = question(clientId);
    assert.equal((await post(first)).statusCode, 201);
    for (let i = 0; i < 5; i += 1) assert.equal((await post(first)).statusCode, 200);
    for (let i = 0; i < 4; i += 1) assert.equal((await post(question(clientId))).statusCode, 201);
  });

  it('両方 0 なら制限なし', async () => {
    process.env.SUBMISSION_LIMIT_PER_DEVICE = '0';
    process.env.SUBMISSION_LIMIT_PER_IP = '0';
    const clientId = crypto.randomUUID();
    for (let i = 0; i < 8; i += 1) assert.equal((await post(question(clientId))).statusCode, 201);
  });

  it('端末IDが UUID でなければ 400', async () => {
    const res = await post({ ...question(), clientId: 'not-a-uuid' });
    assert.equal(res.statusCode, 400);
  });
});
