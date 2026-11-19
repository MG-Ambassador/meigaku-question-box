import crypto from 'node:crypto';
import type { Request } from 'express';
import { Timestamp, type Transaction, type DocumentReference } from '@google-cloud/firestore';
import { COLLECTION_RATE_LIMITS, getFirestore } from './firestore.js';
import type { RateLimitDoc } from './types.js';

const WINDOW_SECONDS = 600; // 10分
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const KEY_VERSION = 'v1';

const DEFAULT_RATE_LIMIT_SECRET = 'meigaku-question-box-default-secret-key';

/**
 * Cloud Run / リバースプロキシ環境からクライアントのIPアドレスを安全に抽出・正規化する。
 * クライアントによる X-Forwarded-For 左端偽装（Spoofing）を防ぐため、
 * 信頼するプロキシ段数（TRUSTED_PROXY_HOPS、デフォルト1＝Google Front End）に基づき末尾側から抽出する。
 */
export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const trustedHops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  let rawIp = '';

  const rawHeaderList =
    typeof forwarded === 'string'
      ? [forwarded]
      : Array.isArray(forwarded)
      ? forwarded
      : [];

  if (rawHeaderList.length > 0) {
    const parts = rawHeaderList
      .flatMap((entry) => entry.split(','))
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      const targetIndex = Math.max(0, parts.length - trustedHops);
      rawIp = parts[targetIndex] || '';
    }
  }

  if (!rawIp) {
    rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
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
  const secret = process.env.RATE_LIMIT_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (!secret || secret === DEFAULT_RATE_LIMIT_SECRET)
  ) {
    throw new Error('MISSING_PRODUCTION_SECRET: RATE_LIMIT_SECRET must be set in production');
  }
  return crypto
    .createHmac('sha256', secret || DEFAULT_RATE_LIMIT_SECRET)
    .update(ip)
    .digest('hex');
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

/**
 * 運営ログイン等の試行制限用キー。scope ごとに名前空間を分け、値（IP・loginId 等）は HMAC 化して保存する。
 */
export function getScopedLimitDocRef(scope: string, value: string): DocumentReference {
  const db = getFirestore();
  const docId = `${scope}_${KEY_VERSION}_${hashIp(`${scope}:${value}`)}`;
  return db.collection(COLLECTION_RATE_LIMITS).doc(docId);
}

export interface RateLimitPolicy {
  windowSeconds: number;
  max: number;
}

/** 旧仕様の質問投稿上限（10分5件）。evaluateRateLimitInTransaction の既定値としてだけ残す */
export const SUBMISSION_LIMIT: RateLimitPolicy = { windowSeconds: WINDOW_SECONDS, max: MAX_SUBMISSIONS_PER_WINDOW };

/** 端末ごとの投稿上限の既定値（10分5件） */
export const DEFAULT_SUBMISSION_DEVICE_MAX = 5;
/**
 * 回線（IP）ごとの投稿上限の既定値（10分300件）。
 * 会場 Wi-Fi のように大勢が同じ IP を使っても届かない値にし、Bot などの大量送信の歯止めにだけ使う。
 */
export const DEFAULT_SUBMISSION_IP_MAX = 300;

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * 質問投稿の上限。環境変数で変えられ、0 にするとその制限は行わない。
 * - SUBMISSION_LIMIT_PER_DEVICE: 端末（ブラウザ）ごと、既定 5
 * - SUBMISSION_LIMIT_PER_IP: 回線（IP）ごと、既定 300
 * 窓はどちらも10分。
 */
export function getSubmissionPolicies(): { device: RateLimitPolicy | null; ip: RateLimitPolicy | null } {
  const deviceMax = readLimit('SUBMISSION_LIMIT_PER_DEVICE', DEFAULT_SUBMISSION_DEVICE_MAX);
  const ipMax = readLimit('SUBMISSION_LIMIT_PER_IP', DEFAULT_SUBMISSION_IP_MAX);
  return {
    device: deviceMax > 0 ? { windowSeconds: WINDOW_SECONDS, max: deviceMax } : null,
    ip: ipMax > 0 ? { windowSeconds: WINDOW_SECONDS, max: ipMax } : null,
  };
}

/** 端末ごとの投稿制限キー。端末ID（ブラウザが作る UUID）も HMAC 化して保存する */
export function getDeviceLimitDocRef(clientId: string): DocumentReference {
  return getScopedLimitDocRef('device', clientId.toLowerCase());
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  updatedAcceptedAt: Timestamp[];
  expiresAt: Timestamp;
}

/**
 * トランザクション内でレート制限を検査する（書き込みは呼び出し元が行う）
 * 既定は質問投稿の 10分 (600秒) 以内に最大5件
 */
export async function evaluateRateLimitInTransaction(
  transaction: Transaction,
  rateLimitRef: DocumentReference,
  nowDate: Date,
  policy: RateLimitPolicy = SUBMISSION_LIMIT
): Promise<RateLimitCheckResult> {
  const { windowSeconds, max } = policy;
  const snapshot = await transaction.get(rateLimitRef);
  const nowMs = nowDate.getTime();
  const cutoffMs = nowMs - windowSeconds * 1000;

  const currentAcceptedAt: Timestamp[] = [];

  if (snapshot.exists) {
    const data = snapshot.data() as RateLimitDoc;
    if (Array.isArray(data.acceptedAt)) {
      for (const t of data.acceptedAt) {
        if (t && typeof t.toMillis === 'function') {
          // 窓の期間内のものだけ保持
          if (t.toMillis() > cutoffMs) {
            currentAcceptedAt.push(t);
          }
        }
      }
    }
  }

  // 既に窓の期間内で上限に達している場合
  if (currentAcceptedAt.length >= max) {
    // 一番古い受付時刻から窓の期間が経過するまでの秒数を計算
    const oldestMs = currentAcceptedAt[0].toMillis();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + windowSeconds * 1000 - nowMs) / 1000));
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
  const expiresAt = Timestamp.fromMillis(nowMs + windowSeconds * 1000);

  return {
    allowed: true,
    updatedAcceptedAt,
    expiresAt,
  };
}
