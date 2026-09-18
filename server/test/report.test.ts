import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, type CursorPayload } from '../src/report.js';

describe('P2 Cursor Pagination - Unit Tests', () => {
  before(() => {
    process.env.CURSOR_SECRET = 'test-cursor-secret-key';
  });

  it('encodeCursor & decodeCursor: 正しくエンコードおよびデコードできること', () => {
    const payload: CursorPayload = {
      eventId: 'event-2026-test',
      watermark: 100,
      lastSequence: 51,
      dataVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000,
      total: 100,
      categories: [{ category: '大学生活', count: 100 }],
      sources: [{ source: 'web', count: 100 }],
      days: [{ day: '2026-09-18', count: 100 }],
    };

    const token = encodeCursor(payload);
    assert.ok(typeof token === 'string');
    assert.ok(token.includes('.'));

    const decoded = decodeCursor(token);
    assert.equal(decoded.eventId, payload.eventId);
    assert.equal(decoded.watermark, payload.watermark);
    assert.equal(decoded.lastSequence, payload.lastSequence);
    assert.equal(decoded.total, payload.total);
    assert.equal(decoded.dataVersion, payload.dataVersion);
  });

  it('decodeCursor: 期限切れカーソルで CURSOR_EXPIRED をスローすること', () => {
    const expiredPayload: CursorPayload = {
      eventId: 'event-2026-test',
      watermark: 100,
      lastSequence: 51,
      dataVersion: 1,
      issuedAt: Date.now() - 700000,
      expiresAt: Date.now() - 100000, // 過去
      total: 100,
      categories: [],
      sources: [],
      days: [],
    };

    const token = encodeCursor(expiredPayload);
    assert.throws(() => decodeCursor(token), {
      message: 'CURSOR_EXPIRED',
    });
  });

  it('decodeCursor: 改ざんされたカーソルで INVALID_CURSOR_SIGNATURE をスローすること', () => {
    const payload: CursorPayload = {
      eventId: 'event-2026-test',
      watermark: 100,
      lastSequence: 51,
      dataVersion: 1,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 600000,
      total: 100,
      categories: [],
      sources: [],
      days: [],
    };

    const token = encodeCursor(payload);
    const [dataB64] = token.split('.');
    // 署名部分を別データにすり替え
    const tamperedToken = `${dataB64}.tampered_signature_string`;

    assert.throws(() => decodeCursor(tamperedToken), {
      message: 'INVALID_CURSOR_SIGNATURE',
    });
  });

  it('decodeCursor: 不正な形式の文字列でエラーをスローすること', () => {
    assert.throws(() => decodeCursor('invalid-token-no-dot'), {
      message: 'INVALID_CURSOR_FORMAT',
    });
  });
});
