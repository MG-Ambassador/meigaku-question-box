import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  getFirestore,
  COLLECTION_QUESTIONS,
  COLLECTION_EVENTS,
  COLLECTION_EVENT_STATS,
  Timestamp,
  formatDayJst,
} from './firestore.js';
import {
  QuestionSubmissionSchema,
  type QuestionDoc,
  type EventDoc,
  type EventStatsDoc,
} from './types.js';
import {
  extractClientIp,
  getRateLimitDocRef,
  evaluateRateLimitInTransaction,
} from './rate-limit.js';

/**
 * requestId から決定的な Firestore ドキュメントIDを生成する (SHA-256)
 */
export function deriveQuestionId(requestId: string): string {
  return crypto.createHash('sha256').update(requestId).digest('hex');
}

/**
 * 投稿内容のハッシュ (requestHash) を生成する
 */
export function calculateRequestHash(
  eventId: string,
  category: string,
  source: string,
  body: string
): string {
  const normalized = `${eventId}:${category}:${source}:${body.trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * POST /api/questions
 * 匿名質問を受け付け、Firestore に冪等・アトミックに保存する
 */
export async function submitQuestionHandler(req: Request, res: Response): Promise<void> {
  // 1. 入力検証
  const parseResult = QuestionSubmissionSchema.safeParse(req.body);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: firstIssue?.message || '入力内容を確認してください。',
      },
    });
    return;
  }

  const { eventId, body, category, source, requestId } = parseResult.data;
  const questionId = deriveQuestionId(requestId);
  const requestHash = calculateRequestHash(eventId, category, source, body);
  const clientIp = extractClientIp(req);

  const db = getFirestore();
  const questionRef = db.collection(COLLECTION_QUESTIONS).doc(questionId);
  const eventRef = db.collection(COLLECTION_EVENTS).doc(eventId);
  const eventStatsRef = db.collection(COLLECTION_EVENT_STATS).doc(eventId);
  const rateLimitRef = getRateLimitDocRef(clientIp);

  try {
    const result = await db.runTransaction(async (transaction) => {
      // 2-a. 既存の質問ドキュメント確認（冪等性チェック）
      const existingQuestionSnap = await transaction.get(questionRef);
      if (existingQuestionSnap.exists) {
        const existingData = existingQuestionSnap.data() as QuestionDoc;
        if (existingData.requestHash === requestHash) {
          // 同一キーかつ同一内容の再送 -> 200 OK で元の受付結果を返す
          return { status: 200, id: questionId, isIdempotentReplay: true };
        } else {
          // 同一キーで内容が異なる不正な再送 -> 409
          return { status: 409, code: 'REQUEST_CONFLICT', message: '同一の送信識別子で異なる内容が送信されました。' };
        }
      }

      // 2-b. 新規投稿の全読み取り
      const [eventSnap, eventStatsSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(eventStatsRef),
      ]);

      // イベントの存在と受付状態の検査
      if (!eventSnap.exists) {
        return { status: 404, code: 'EVENT_NOT_FOUND', message: '指定されたイベントが見つかりません。' };
      }
      const eventData = eventSnap.data() as EventDoc;
      if (!eventData.open) {
        return { status: 409, code: 'EVENT_CLOSED', message: 'このイベントは質問の受付を終了しています。' };
      }

      // レート制限の検査（同一トランザクション内）
      const now = new Date();
      const rateLimitResult = await evaluateRateLimitInTransaction(transaction, rateLimitRef, now);
      if (!rateLimitResult.allowed) {
        return {
          status: 429,
          code: 'RATE_LIMITED',
          message: '続けて投稿されています。少し時間をおいてから再度お試しください。',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        };
      }

      // 2-c. eventStats の計算と sequence 採番
      let statsData: EventStatsDoc;
      if (eventStatsSnap.exists) {
        statsData = eventStatsSnap.data() as EventStatsDoc;
      } else {
        statsData = {
          total: 0,
          lastSequence: 0,
          categories: {},
          sources: {},
          recentDays: {},
          updatedAt: Timestamp.fromDate(now),
          dataVersion: 1,
          schemaVersion: 1,
        };
      }

      const nextSequence = (statsData.lastSequence || 0) + 1;
      const dayJst = formatDayJst(now);

      // カテゴリ・流入元・日別集計の更新
      const updatedCategories = {
        ...statsData.categories,
        [category]: (statsData.categories[category] || 0) + 1,
      };
      const updatedSources = {
        ...statsData.sources,
        [source]: (statsData.sources[source] || 0) + 1,
      };

      // recentDays は投稿のあった直近30日分に制限
      const updatedRecentDays = { ...statsData.recentDays };
      updatedRecentDays[dayJst] = (updatedRecentDays[dayJst] || 0) + 1;
      const sortedDays = Object.keys(updatedRecentDays).sort();
      if (sortedDays.length > 30) {
        const toRemove = sortedDays.slice(0, sortedDays.length - 30);
        for (const d of toRemove) {
          delete updatedRecentDays[d];
        }
      }

      const createdAtTimestamp = Timestamp.fromDate(now);

      // 2-d. 原子的な書き込み
      const newQuestion: QuestionDoc = {
        eventId,
        body: body.trim(),
        category,
        source,
        requestHash,
        createdAt: createdAtTimestamp,
        dayJst,
        sequence: nextSequence,
        schemaVersion: 1,
      };

      transaction.set(questionRef, newQuestion);

      transaction.set(
        rateLimitRef,
        {
          acceptedAt: rateLimitResult.updatedAcceptedAt,
          expiresAt: rateLimitResult.expiresAt,
        },
        { merge: true }
      );

      transaction.set(
        eventStatsRef,
        {
          total: (statsData.total || 0) + 1,
          lastSequence: nextSequence,
          categories: updatedCategories,
          sources: updatedSources,
          recentDays: updatedRecentDays,
          updatedAt: createdAtTimestamp,
          dataVersion: statsData.dataVersion || 1,
          schemaVersion: 1,
        },
        { merge: true }
      );

      return { status: 201, id: questionId };
    });

    if (result.status === 200 || result.status === 201) {
      res.status(result.status).json({
        ok: true,
        id: result.id,
        requestId,
      });
      return;
    }

    if (result.status === 429) {
      if (result.retryAfterSeconds) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
      }
      res.status(429).json({
        error: {
          code: result.code,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
      return;
    }

    res.status(result.status).json({
      error: {
        code: result.code,
        message: result.message,
      },
    });
  } catch (error) {
    console.error('Error submitting question:', error);
    res.status(503).json({
      error: {
        code: 'SUBMISSION_UNCERTAIN',
        message: '送信の処理中に問題が発生しました。しばらくしてから再度送信してください。',
      },
    });
  }
}
