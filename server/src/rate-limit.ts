import crypto from 'node:crypto';
import type { Request } from 'express';
import { Timestamp, type Transaction, type DocumentReference } from '@google-cloud/firestore';
import { COLLECTION_RATE_LIMITS, getFirestore } from './firestore.js';
import type { RateLimitDoc } from './types.js';

const WINDOW_SECONDS = 600; // 10分
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const KEY_VERSION = 'v1';

/**
 * Cloud Run / リバースプロキシ環境からクライアントのIPアドレスを安全に抽出・正規化する
 */
export function extractClientIp(req: Request): string {
  // Cloud Run または Google Cloud Load Balancer では
  // X-Forwarded-For: <client-ip>, <proxy-1>, <proxy-2> の形式で入る。
  // 一番左がクライアントと主張されたIPだが、スプーフィングの可能性を考慮し
  // 複数段ある場合は末尾のGoogle信頼プロキシ手前のホップを参照するか、
  // 信頼されたヘッダーから抽出する。
  const forwarded = req.headers['x-forwarded-for'];
  let rawIp = '';

  if (typeof forwarded === 'string') {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    // Cloud Run の直前プロキシ(Google Front End)を考慮:
    // 通常、parts[0] がクライアントIP
    rawIp = parts[0] || '';
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    rawIp = forwarded[0].split(',')[0].trim();
  }

  if (!rawIp) {
    rawIp = req.socket.remoteAddress || req.ip || '127.0.0.1';
  }

  // IPv4-mapped IPv6 (::ffff:192.0.2.1) の正規化
  if (rawIp.startsWith('::ffff:')) {
    rawIp = rawIp.slice(7);
  }

  return rawIp.trim().toLowerCase();
}

/**
 * IPアドレスを生保存せず、HMAC-SHA256 でハッシュ化する
 */
export function hashIp(ip: string): string {
  const secret = process.env.RATE_LIMIT_SECRET || 'meigaku-question-box-default-secret-key';
  return crypto.createHmac('sha256', secret).update(ip).digest('hex');
}

/**
 * Firestoreドキュメントのキーを生成する
 */
export function getRateLimitDocRef(ip: string): DocumentReference {
  const db = getFirestore();
  const ipHmac = hashIp(ip);
  const docId = `${KEY_VERSION}_${ipHmac}`;
  return db.collection(COLLECTION_RATE_LIMITS).doc(docId);
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  updatedAcceptedAt: Timestamp[];
  expiresAt: Timestamp;
}

/**
 * トランザクション内でレート制限を検査・更新する
 * 10分 (600秒) 以内に最大5件の投稿を許可
 */
export async function evaluateRateLimitInTransaction(
  transaction: Transaction,
  rateLimitRef: DocumentReference,
  nowDate: Date
): Promise<RateLimitCheckResult> {
  const snapshot = await transaction.get(rateLimitRef);
  const nowMs = nowDate.getTime();
  const cutoffMs = nowMs - WINDOW_SECONDS * 1000;

  const currentAcceptedAt: Timestamp[] = [];

  if (snapshot.exists) {
    const data = snapshot.data() as RateLimitDoc;
    if (Array.isArray(data.acceptedAt)) {
      for (const t of data.acceptedAt) {
        if (t && typeof t.toMillis === 'function') {
          // 600秒以内のものだけ保持
          if (t.toMillis() > cutoffMs) {
            currentAcceptedAt.push(t);
          }
        }
      }
    }
  }

  // 既に直近600秒で5件に達している場合
  if (currentAcceptedAt.length >= MAX_SUBMISSIONS_PER_WINDOW) {
    // 一番古い受付時刻から600秒経過するまでの秒数を計算
    const oldestMs = currentAcceptedAt[0].toMillis();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + WINDOW_SECONDS * 1000 - nowMs) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      updatedAcceptedAt: currentAcceptedAt,
      expiresAt: Timestamp.fromMillis(nowMs + retryAfterSeconds * 1000),
    };
  }

  // 許容される場合：新しいタイムスタンプを追加
  const newTimestamp = Timestamp.fromDate(nowDate);
  const updatedAcceptedAt = [...currentAcceptedAt, newTimestamp];
  const expiresAt = Timestamp.fromMillis(nowMs + WINDOW_SECONDS * 1000);

  return {
    allowed: true,
    updatedAcceptedAt,
    expiresAt,
  };
}
