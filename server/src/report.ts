import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  getFirestore,
  COLLECTION_EVENT_STATS,
  COLLECTION_QUESTIONS,
  COLLECTION_EVENTS,
  COLLECTION_USER_FAVORITES,
  Timestamp,
} from './firestore.js';
import {
  type EventStatsDoc,
  type QuestionDoc,
  type EventDoc,
  type Category,
  CATEGORY_ORDER,
  FavoriteActionSchema,
} from './types.js';

const CURSOR_TTL_MS = 10 * 60 * 1000; // 10分有効
const MAX_CURSOR_SIZE = 4096; // 4KB

export interface CursorPayload {
  eventId: string;
  watermark: number;
  lastSequence: number;
  lastCategoryOrder?: number;
  dataVersion: number;
  issuedAt: number;
  expiresAt: number;
  total: number;
  filteredTotal?: number;
  favoriteRevision?: number;
  filterHash?: string;
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

function computeFilterHash(params: {
  category?: string;
  sort?: string;
  favorite?: string;
  day?: string;
  source?: string;
  sub?: string;
}): string {
  const norm = `${params.category || ''}:${params.sort || 'newest'}:${params.favorite || 'all'}:${params.day || ''}:${params.source || ''}:${params.favorite === 'favorite' ? params.sub || '' : ''}`;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function favoriteStateRef(sub: string, eventId: string) {
  const id = crypto.createHash('sha256').update(JSON.stringify([sub, eventId])).digest('hex');
  return getFirestore().collection('favoriteStates').doc(id);
}

function orderedPage(query: any, sort: string, cursor: CursorPayload | null) {
  if (sort === 'theme') {
    query = query.orderBy('categoryOrder', 'asc').orderBy('sequence', 'desc');
    if (cursor) query = query.startAfter(cursor.lastCategoryOrder, cursor.lastSequence);
  } else {
    query = query.orderBy('sequence', sort === 'oldest' ? 'asc' : 'desc');
    if (cursor) query = query.startAfter(cursor.lastSequence);
  }
  return query;
}

/**
 * GET /api/admin
 * 管理画面用：選択されたイベントの集計情報および最新の質問一覧を取得する（条件付き検索・並び替え・お気に入り対応）
 */
export async function getAdminReportHandler(req: Request, res: Response): Promise<void> {
  const eventId = typeof req.query.event === 'string' ? req.query.event : '';
  const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(typeof req.query.pageSize === 'string' ? req.query.pageSize : '50', 10) || 50)
  );

  const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
  const sort = typeof req.query.sort === 'string' && ['newest', 'oldest', 'theme'].includes(req.query.sort) ? req.query.sort : 'newest';
  const favorite = typeof req.query.favorite === 'string' && ['favorite', 'true'].includes(req.query.favorite) ? 'favorite' : 'all';
  const day = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : undefined;
  const source = typeof req.query.source === 'string' && ['web', 'instagram'].includes(req.query.source) ? req.query.source : undefined;
  const actorSub = req.adminUser?.sub || '';

  if (!eventId) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'eventパラメータを指定してください。',
      },
    });
    return;
  }

  const currentFilterHash = computeFilterHash({ category, sort, favorite, day, source, sub: actorSub });
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

      if (decodedCursor.filterHash && decodedCursor.filterHash !== currentFilterHash) {
        res.status(400).json({
          error: {
            code: 'INVALID_CURSOR',
            message: '検索条件がカーソルと一致しません。一覧を再読み込みしてください。',
          },
        });
        return;
      }
    }

    // 2. イベントの存在確認およびステータス検証
    const eventSnap = await db.collection(COLLECTION_EVENTS).doc(eventId).get();
    if (!eventSnap.exists) {
      res.status(404).json({
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'イベントが見つかりません。',
        },
      });
      return;
    }
    const eventData = eventSnap.data() as EventDoc;
    if (eventData.status === 'deleted') {
      res.status(404).json({
        error: {
          code: 'EVENT_DELETED',
          message: 'ごみ箱のイベントの質問は取得できません。',
        },
      });
      return;
    }

    // 3. 集計ドキュメントの取得
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
        .map(([c, count]) => ({ category: c, count }))
        .sort((a, b) => b.count - a.count);
      sources = Object.entries(stats?.sources || {})
        .map(([s, count]) => ({ source: s, count }))
        .sort((a, b) => b.count - a.count);
      days = Object.entries(stats?.recentDays || {})
        .map(([d, count]) => ({ day: d, count }))
        .sort((a, b) => a.day.localeCompare(b.day));
      watermark = stats?.lastSequence || 0;
    }

    // Read the membership revision before and after the page to detect concurrent edits.
    if (favorite === 'favorite') {
      if (!actorSub) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '認証が必要です。' } });
        return;
      }
      const revisionRef = favoriteStateRef(actorSub, eventId);
      const revision = (await revisionRef.get()).data()?.revision ?? 0;
      if (decodedCursor && (decodedCursor.favoriteRevision !== revision || decodedCursor.filterHash !== currentFilterHash)) {
        res.status(409).json({ error: { code: 'CURSOR_EXPIRED', message: 'お気に入りが変更されました。一覧を更新してください。' } });
        return;
      }
      let query: any = db.collection(COLLECTION_USER_FAVORITES)
        .where('sub', '==', actorSub).where('eventId', '==', eventId)
        .where('active', '==', true).where('sequence', '<=', watermark);
      if (category) query = query.where('category', '==', category);
      if (source) query = query.where('source', '==', source);
      if (day) query = query.where('dayJst', '==', day);
      const filteredTotal = decodedCursor?.filteredTotal ?? (await query.count().get()).data().count;
      const page = await orderedPage(query, sort, decodedCursor).limit(pageSize + 1).get();
      const hasNext = page.docs.length > pageSize;
      const favorites = page.docs.slice(0, pageSize).map((doc: any) => doc.data());
      const questions = await Promise.all(favorites.map((f: any) => db.collection(COLLECTION_QUESTIONS).doc(f.questionId).get()));
      const rows = questions.map((doc, i) => {
        if (!doc.exists || doc.data()?.eventId !== eventId) throw new Error('Favorite question is unavailable');
        const data = doc.data() as QuestionDoc;
        return { id: doc.id, body: data.body, category: data.category,
          categoryOrder: CATEGORY_ORDER[data.category], source: data.source,
          created_at: data.createdAt.toMillis(), sequence: data.sequence, isFavorite: true };
      });
      if (((await revisionRef.get()).data()?.revision ?? 0) !== revision) {
        res.status(409).json({ error: { code: 'CURSOR_EXPIRED', message: 'お気に入りが変更されました。一覧を更新してください。' } });
        return;
      }
      const last = favorites.at(-1);
      const now = Date.now();
      const nextCursor = hasNext ? encodeCursor({ eventId, watermark, lastSequence: last.sequence,
        lastCategoryOrder: CATEGORY_ORDER[last.category as Category], dataVersion: currentDataVersion,
        issuedAt: now, expiresAt: now + CURSOR_TTL_MS, total, filteredTotal,
        favoriteRevision: revision, filterHash: currentFilterHash, categories, sources, days }) : null;
      res.json({ total, filteredTotal, favoriteRevision: revision, pageSize, hasNext, nextCursor,
        generatedAt: now, categories, sources, days, rows });
      return;
    }

    let questionsQuery: any = db
      .collection(COLLECTION_QUESTIONS)
      .where('eventId', '==', eventId);

    if (category) {
      questionsQuery = questionsQuery.where('category', '==', category);
    }
    if (source) {
      questionsQuery = questionsQuery.where('source', '==', source);
    }
    if (day) {
      questionsQuery = questionsQuery.where('dayJst', '==', day);
    }

    questionsQuery = questionsQuery.where('sequence', '<=', watermark);

    if (sort === 'oldest') {
      if (decodedCursor) {
        questionsQuery = questionsQuery.where('sequence', '>', decodedCursor.lastSequence);
      }
      questionsQuery = questionsQuery.orderBy('sequence', 'asc');
    } else if (sort === 'theme') {
      questionsQuery = questionsQuery.orderBy('categoryOrder', 'asc').orderBy('sequence', 'desc');
      if (decodedCursor && decodedCursor.lastCategoryOrder !== undefined && typeof questionsQuery.startAfter === 'function') {
        questionsQuery = questionsQuery.startAfter(decodedCursor.lastCategoryOrder, decodedCursor.lastSequence);
      }
    } else {
      // newest (デフォルト)
      if (decodedCursor) {
        questionsQuery = questionsQuery.where('sequence', '<', decodedCursor.lastSequence);
      }
      questionsQuery = questionsQuery.orderBy('sequence', 'desc');
    }

    questionsQuery = questionsQuery.limit(pageSize + 1);
    const questionsSnap = await questionsQuery.get();

    const hasNext = questionsSnap.docs.length > pageSize;
    const pageDocs = hasNext ? questionsSnap.docs.slice(0, pageSize) : questionsSnap.docs;

    // Only read favorite flags for the visible page; errors must not look like cleared stars.
    const favoriteFlags = actorSub ? await Promise.all(pageDocs.map((doc: any) =>
      db.collection(COLLECTION_USER_FAVORITES).doc(`${actorSub}_${doc.id}`).get())) : [];
    const favQuestionIds = new Set(pageDocs.filter((doc: any, i: number) => favoriteFlags[i]?.data()?.active === true).map((doc: any) => doc.id));

    const rows = pageDocs.map((doc: any) => {
      const data = doc.data() as QuestionDoc;
      return {
        id: doc.id,
        body: data.body,
        category: data.category,
        categoryOrder: data.categoryOrder ?? (CATEGORY_ORDER[data.category as Category] ?? 4),
        source: data.source,
        created_at: (data.createdAt as any)?.toMillis ? (data.createdAt as any).toMillis() : (data.createdAt || Date.now()),
        sequence: data.sequence,
        isFavorite: favQuestionIds.has(doc.id),
      };
    });

    // フィルタ後件数の算出 (単一条件キャッシュ利用、複合条件集計)
    let filteredTotal = total;
    if (decodedCursor?.filteredTotal !== undefined) {
      filteredTotal = decodedCursor.filteredTotal;
    } else {
      const activeFilterCount = (category ? 1 : 0) + (source ? 1 : 0) + (day ? 1 : 0);
      if (activeFilterCount === 0) {
        filteredTotal = total;
      } else if (activeFilterCount === 1 && !day) {
        if (category) filteredTotal = stats?.categories?.[category] || 0;
        else if (source) filteredTotal = stats?.sources?.[source] || 0;
        else if (day) filteredTotal = stats?.recentDays?.[day] || 0;
      } else {
        // 複合条件 (2つ以上のフィルタが指定されている場合)
        let countQuery: any = db.collection(COLLECTION_QUESTIONS)
          .where('eventId', '==', eventId)
          .where('sequence', '<=', watermark);
        if (category) countQuery = countQuery.where('category', '==', category);
        if (source) countQuery = countQuery.where('source', '==', source);
        if (day) countQuery = countQuery.where('dayJst', '==', day);

        const countSnap = await countQuery.count().get();
        filteredTotal = countSnap.data().count;
      }
    }

    // 次ページ用カーソルを発行
    let nextCursor: string | null = null;
    if (hasNext && pageDocs.length > 0) {
      const lastRow = pageDocs[pageDocs.length - 1].data() as QuestionDoc;
      const now = Date.now();
      const nextPayload: CursorPayload = {
        eventId,
        watermark,
        lastSequence: lastRow.sequence,
        lastCategoryOrder: lastRow.categoryOrder,
        dataVersion: currentDataVersion,
        issuedAt: now,
        expiresAt: now + CURSOR_TTL_MS,
        total,
        filteredTotal,
        filterHash: currentFilterHash,
        categories,
        sources,
        days,
      };
      nextCursor = encodeCursor(nextPayload);
    }

    res.json({
      total,
      filteredTotal,
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

/**
 * PUT /api/admin/questions/:id/favorite
 * 質問のお気に入り状態を希望値に更新する（個人用・冪等）
 */
export async function toggleQuestionFavoriteHandler(req: Request, res: Response): Promise<void> {
  const questionId = req.params.id;
  const actorSub = req.adminUser?.sub;
  if (!actorSub) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '認証が必要です。' } });
    return;
  }

  const parseResult = FavoriteActionSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'favorite (boolean) を指定してください。',
      },
    });
    return;
  }

  const { favorite } = parseResult.data;
  const db = getFirestore();

  try {
    const result = await db.runTransaction(async (transaction) => {
      const questionRef = db.collection(COLLECTION_QUESTIONS).doc(questionId);
      const questionSnap = await transaction.get(questionRef);
      if (!questionSnap.exists) return { status: 404, code: 'QUESTION_NOT_FOUND', message: '質問が見つかりません。' };
      const questionData = questionSnap.data() as QuestionDoc;
      const eventRef = db.collection(COLLECTION_EVENTS).doc(questionData.eventId);
      const favDocRef = db.collection(COLLECTION_USER_FAVORITES).doc(`${actorSub}_${questionId}`);
      const revisionRef = favoriteStateRef(actorSub, questionData.eventId);
      const [eventSnap, favoriteSnap, revisionSnap] = await Promise.all([
        transaction.get(eventRef), transaction.get(favDocRef), transaction.get(revisionRef),
      ]);
      if (!eventSnap.exists) return { status: 404, code: 'EVENT_NOT_FOUND', message: 'ルームが見つかりません。' };
      if (eventSnap.data()?.status === 'deleted') return { status: 404, code: 'EVENT_DELETED', message: 'ごみ箱の質問は変更できません。' };
      const previous = favoriteSnap.data()?.active === true;
      // Retried PUTs do not invalidate cursors unnecessarily.
      if (previous === favorite && favoriteSnap.data()?.categoryOrder !== undefined) return null;
      const now = Timestamp.now();
      transaction.set(favDocRef, {
        sub: actorSub, questionId, eventId: questionData.eventId, category: questionData.category,
        categoryOrder: CATEGORY_ORDER[questionData.category], dayJst: questionData.dayJst,
        source: questionData.source, sequence: questionData.sequence, active: favorite, updatedAt: now,
      });
      transaction.set(revisionRef, { revision: (revisionSnap.data()?.revision ?? 0) + 1, updatedAt: now });
      return null;
    });
    if (result) { res.status(result.status).json({ error: { code: result.code, message: result.message } }); return; }

    res.json({ ok: true, questionId, favorite });
  } catch (error) {
    console.error('Error updating favorite:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'お気に入りの更新に失敗しました。',
      },
    });
  }
}
