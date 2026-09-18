import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  getFirestore,
  COLLECTION_EVENT_STATS,
  COLLECTION_QUESTIONS,
} from './firestore.js';
import type { EventStatsDoc, QuestionDoc } from './types.js';

const CURSOR_TTL_MS = 10 * 60 * 1000; // 10分有効
const MAX_CURSOR_SIZE = 4096; // 4KB

export interface CursorPayload {
  eventId: string;
  watermark: number;
  lastSequence: number;
  dataVersion: number;
  issuedAt: number;
  expiresAt: number;
  total: number;
  categories: { category: string; count: number }[];
  sources: { source: string; count: number }[];
  days: { day: string; count: number }[];
}

function getCursorSecret(): string {
  return process.env.CURSOR_SECRET || 'meigaku-question-box-cursor-secret-key';
}

/**
 * カーソルペイロードを HMAC-SHA256 で署名し、不透明な文字列としてシリアライズする
 */
export function encodeCursor(payload: CursorPayload): string {
  const jsonStr = JSON.stringify(payload);
  const dataB64 = Buffer.from(jsonStr, 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getCursorSecret())
    .update(dataB64)
    .digest('base64url');
  return `${dataB64}.${signature}`;
}

/**
 * 署名付きカーソル文字列を検証・デコードする
 */
export function decodeCursor(cursorStr: string): CursorPayload {
  if (!cursorStr || cursorStr.length > MAX_CURSOR_SIZE) {
    throw new Error('INVALID_CURSOR_FORMAT');
  }

  const parts = cursorStr.split('.');
  if (parts.length !== 2) {
    throw new Error('INVALID_CURSOR_FORMAT');
  }

  const [dataB64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', getCursorSecret())
    .update(dataB64)
    .digest('base64url');

  // タイミング攻撃対策のセキュアな文字列比較
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    throw new Error('INVALID_CURSOR_SIGNATURE');
  }

  try {
    const jsonStr = Buffer.from(dataB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(jsonStr) as CursorPayload;

    if (
      !payload.eventId ||
      typeof payload.watermark !== 'number' ||
      typeof payload.lastSequence !== 'number' ||
      typeof payload.expiresAt !== 'number'
    ) {
      throw new Error('INVALID_CURSOR_PAYLOAD');
    }

    if (Date.now() > payload.expiresAt) {
      throw new Error('CURSOR_EXPIRED');
    }

    return payload;
  } catch (e: any) {
    if (e?.message === 'CURSOR_EXPIRED') throw e;
    throw new Error('INVALID_CURSOR_PAYLOAD');
  }
}

/**
 * GET /api/admin/me
 * ログイン中の管理者情報を確認する
 */
export async function getAdminMeHandler(req: Request, res: Response): Promise<void> {
  if (!req.adminUser) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: '認証が必要です。',
      },
    });
    return;
  }

  res.json({
    displayName: req.adminUser.displayName,
    sub: req.adminUser.sub,
    email: req.adminUser.email,
  });
}

/**
 * GET /api/admin?event=<id>&pageSize=50&cursor=<opaque>
 * 管理画面用：選択されたイベントの集計情報および最新の質問一覧を取得する
 */
export async function getAdminReportHandler(req: Request, res: Response): Promise<void> {
  const eventId = typeof req.query.event === 'string' ? req.query.event : '';
  const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(typeof req.query.pageSize === 'string' ? req.query.pageSize : '50', 10) || 50)
  );

  if (!eventId) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'eventパラメータを指定してください。',
      },
    });
    return;
  }

  const db = getFirestore();

  try {
    // 1. カーソルが指定されている場合の検証
    let decodedCursor: CursorPayload | null = null;
    if (rawCursor) {
      try {
        decodedCursor = decodeCursor(rawCursor);
      } catch (err: any) {
        if (err.message === 'CURSOR_EXPIRED') {
          res.status(409).json({
            error: {
              code: 'CURSOR_EXPIRED',
              message: 'カーソルの有効期限が切れています。一覧を再読み込みしてください。',
            },
          });
          return;
        }
        res.status(400).json({
          error: {
            code: 'INVALID_CURSOR',
            message: 'カーソルが無効または改ざんされています。一覧を再読み込みしてください。',
          },
        });
        return;
      }

      if (decodedCursor.eventId !== eventId) {
        res.status(400).json({
          error: {
            code: 'INVALID_CURSOR',
            message: 'カーソルの対象イベントが異なります。',
          },
        });
        return;
      }
    }

    // 2. 集計ドキュメントの取得
    const statsSnap = await db.collection(COLLECTION_EVENT_STATS).doc(eventId).get();
    const stats = (statsSnap.exists ? statsSnap.data() : null) as EventStatsDoc | null;
    const currentDataVersion = stats?.dataVersion || 1;

    // カーソルに記録された dataVersion と現在の dataVersion が異なる場合は失効
    if (decodedCursor && decodedCursor.dataVersion !== currentDataVersion) {
      res.status(409).json({
        error: {
          code: 'CURSOR_EXPIRED',
          message: 'データ構造または保守操作によりカーソルが無効化されました。一覧を再読み込みしてください。',
        },
      });
      return;
    }

    let total: number;
    let categories: { category: string; count: number }[];
    let sources: { source: string; count: number }[];
    let days: { day: string; count: number }[];
    let watermark: number;

    if (decodedCursor) {
      // 2ページ目以降：カーソル内の初回収集スナップショットを引き継ぐ（ページ間で集計がズレない）
      total = decodedCursor.total;
      categories = decodedCursor.categories;
      sources = decodedCursor.sources;
      days = decodedCursor.days;
      watermark = decodedCursor.watermark;
    } else {
      // 1ページ目：最新の集計ドキュメントから生成
      total = stats?.total || 0;
      categories = Object.entries(stats?.categories || {})
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
      sources = Object.entries(stats?.sources || {})
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);
      days = Object.entries(stats?.recentDays || {})
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));
      watermark = stats?.lastSequence || 0;
    }

    // 3. 質問一覧のクエリ構築
    let questionsQuery = db
      .collection(COLLECTION_QUESTIONS)
      .where('eventId', '==', eventId);

    if (decodedCursor) {
      // 次ページ: cursor.lastSequence より小さい sequence を取得
      questionsQuery = questionsQuery
        .where('sequence', '<', decodedCursor.lastSequence)
        .orderBy('sequence', 'desc');
    } else {
      // 初回: watermark 以下の sequence を取得
      if (watermark > 0) {
        questionsQuery = questionsQuery
          .where('sequence', '<=', watermark)
          .orderBy('sequence', 'desc');
      } else {
        questionsQuery = questionsQuery.orderBy('sequence', 'desc');
      }
    }

    questionsQuery = questionsQuery.limit(pageSize + 1);
    const questionsSnap = await questionsQuery.get();

    const hasNext = questionsSnap.docs.length > pageSize;
    const pageDocs = hasNext ? questionsSnap.docs.slice(0, pageSize) : questionsSnap.docs;

    const rows = pageDocs.map((doc) => {
      const data = doc.data() as QuestionDoc;
      return {
        id: doc.id,
        body: data.body,
        category: data.category,
        source: data.source,
        created_at: data.createdAt?.toMillis() || Date.now(),
        sequence: data.sequence,
      };
    });

    // 4. hasNext が true の場合、次ページ用カーソルを発行
    let nextCursor: string | null = null;
    if (hasNext && pageDocs.length > 0) {
      const lastRow = pageDocs[pageDocs.length - 1].data() as QuestionDoc;
      const now = Date.now();
      const nextPayload: CursorPayload = {
        eventId,
        watermark,
        lastSequence: lastRow.sequence,
        dataVersion: currentDataVersion,
        issuedAt: now,
        expiresAt: now + CURSOR_TTL_MS,
        total,
        categories,
        sources,
        days,
      };
      nextCursor = encodeCursor(nextPayload);
    }

    res.json({
      total,
      pageSize,
      hasNext,
      nextCursor,
      generatedAt: Date.now(),
      categories,
      sources,
      days,
      rows,
    });
  } catch (error) {
    console.error('Error getting admin report:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: '集計・質問データを取得できませんでした。',
      },
    });
  }
}
