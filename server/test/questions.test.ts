import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionSubmissionSchema } from '../src/types.js';
import { deriveQuestionId, calculateRequestHash } from '../src/questions.js';
import { hashIp } from '../src/rate-limit.js';

describe('P1 Questions API - Unit Tests', () => {
  it('QuestionSubmissionSchema: 有効な入力を通過させること', () => {
    const validData = {
      eventId: 'event-2026-summer',
      body: 'オープンキャンパスの学食は誰でも利用できますか？',
      category: '大学生活',
      source: 'web',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = QuestionSubmissionSchema.safeParse(validData);
    assert.equal(result.success, true);
  });

  it('QuestionSubmissionSchema: 1文字の質問を許容すること', () => {
    const validData = {
      eventId: 'event-2026-summer',
      body: 'あ',
      category: '大学生活',
      source: 'web',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = QuestionSubmissionSchema.safeParse(validData);
    assert.equal(result.success, true);
  });

  it('QuestionSubmissionSchema: 空白のみの質問を拒絶すること', () => {
    const invalidData = {
      eventId: 'event-2026-summer',
      body: '   ',
      category: '大学生活',
      source: 'web',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = QuestionSubmissionSchema.safeParse(invalidData);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0].message, /質問を入力してください/);
    }
  });

  it('QuestionSubmissionSchema: 不正なカテゴリを拒絶すること', () => {
    const invalidData = {
      eventId: 'event-2026-summer',
      body: 'サークルの活動頻度はどのくらいですか？',
      category: '不正なカテゴリ',
      source: 'web',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const result = QuestionSubmissionSchema.safeParse(invalidData);
    assert.equal(result.success, false);
  });

  it('QuestionSubmissionSchema: 不正なrequestId (UUID形式以外) を拒絶すること', () => {
    const invalidData = {
      eventId: 'event-2026-summer',
      body: 'サークルの活動頻度はどのくらいですか？',
      category: '大学生活',
      source: 'web',
      requestId: 'invalid-id-1234',
    };

    const result = QuestionSubmissionSchema.safeParse(invalidData);
    assert.equal(result.success, false);
  });

  it('deriveQuestionId: 同一requestIdから決定的なドキュメントIDを生成すること', () => {
    const reqId = '550e8400-e29b-41d4-a716-446655440000';
    const id1 = deriveQuestionId(reqId);
    const id2 = deriveQuestionId(reqId);
    assert.equal(id1, id2);
    assert.equal(id1.length, 64); // SHA-256 hex
  });

  it('calculateRequestHash: 投稿内容から正しくハッシュを算出すること', () => {
    const hash1 = calculateRequestHash('event-1', '大学生活', 'web', '質問本文テストです');
    const hash2 = calculateRequestHash('event-1', '大学生活', 'web', '質問本文テストです');
    const hashDiff = calculateRequestHash('event-1', '大学生活', 'web', '別の本文です');

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hashDiff);
  });

  it('hashIp: クライアント生IPをHMACハッシュ化すること', () => {
    const ip = '192.0.2.1';
    const hmac1 = hashIp(ip);
    const hmac2 = hashIp(ip);

    assert.equal(hmac1, hmac2);
    assert.notEqual(hmac1, ip);
    assert.equal(hmac1.length, 64);
  });
});
