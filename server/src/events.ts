import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  getFirestore,
  COLLECTION_EVENTS,
  COLLECTION_EVENT_STATS,
  COLLECTION_AUDIT,
  Timestamp,
} from './firestore.js';
import {
  CreateEventSchema,
  PatchEventSchema,
  type EventDoc,
  type EventStatsDoc,
  type AuditDoc,
} from './types.js';

function formatEventResponse(id: string, doc: EventDoc) {
  return {
    id,
    title: doc.title,
    date: doc.date,
    open: doc.open ? 1 : 0, // 既存フロントエンド互換 (1 or 0)
    version: doc.version,
    created_at: doc.createdAt?.toMillis() || Date.now(),
    updated_at: doc.updatedAt?.toMillis() || Date.now(),
  };
}

/**
 * GET /api/events
 * 公開用：受付中のイベント一覧を返す（最新作成順）
 */
export async function listPublicEventsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_EVENTS)
      .where('open', '==', true)
      .get();

    const events = snapshot.docs
      .map((doc) => formatEventResponse(doc.id, doc.data() as EventDoc))
      .sort((a, b) => b.created_at - a.created_at);

    res.json(events);
  } catch (error) {
    console.error('Error fetching public events:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベント情報を読み込めませんでした。',
      },
    });
  }
}

/**
 * GET /api/events/:id
 * 単一イベントの詳細（公開メタデータ）
 */
export async function getEventByIdHandler(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  try {
    const db = getFirestore();
    const docSnap = await db.collection(COLLECTION_EVENTS).doc(eventId).get();

    if (!docSnap.exists) {
      res.status(404).json({
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'イベントが見つかりません。',
        },
      });
      return;
    }

    const data = docSnap.data() as EventDoc;
    res.json(formatEventResponse(docSnap.id, data));
  } catch (error) {
    console.error('Error fetching event by id:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベント情報を取得できませんでした。',
      },
    });
  }
}

/**
 * GET /api/admin/events
 * 管理用：閉鎖中を含む全イベント一覧（要認証）
 */
export async function listAdminEventsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTION_EVENTS).get();

    const events = snapshot.docs
      .map((doc) => formatEventResponse(doc.id, doc.data() as EventDoc))
      .sort((a, b) => b.created_at - a.created_at);

    res.json(events);
  } catch (error) {
    console.error('Error fetching admin events:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベント一覧を取得できませんでした。',
      },
    });
  }
}

/**
 * POST /api/events
 * イベントの新規作成または更新（要認証）
 */
export async function saveEventHandler(req: Request, res: Response): Promise<void> {
  const actorSub = req.adminUser?.sub || 'system';
  const parseResult = CreateEventSchema.safeParse(req.body);

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

  const { id: specifiedId, title, date, open } = parseResult.data;
  const db = getFirestore();
  const eventId = specifiedId || crypto.randomUUID();
  const eventRef = db.collection(COLLECTION_EVENTS).doc(eventId);
  const eventStatsRef = db.collection(COLLECTION_EVENT_STATS).doc(eventId);
  const auditRef = db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID());

  try {
    const now = new Date();
    const nowTimestamp = Timestamp.fromDate(now);

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(eventRef);

      if (!snap.exists) {
        // 新規作成
        const newEvent: EventDoc = {
          title: title.trim(),
          date: (date || '').trim(),
          open,
          version: 1,
          createdAt: nowTimestamp,
          updatedAt: nowTimestamp,
          updatedBy: actorSub,
          schemaVersion: 1,
        };

        const initialStats: EventStatsDoc = {
          total: 0,
          lastSequence: 0,
          categories: {},
          sources: {},
          recentDays: {},
          updatedAt: nowTimestamp,
          dataVersion: 1,
          schemaVersion: 1,
        };

        const auditLog: AuditDoc = {
          actorSub,
          action: 'event_create',
          eventId,
          version: 1,
          createdAt: nowTimestamp,
        };

        transaction.set(eventRef, newEvent);
        transaction.set(eventStatsRef, initialStats);
        transaction.set(auditRef, auditLog);
      } else {
        // 既存更新（互換性のための既存保存処理）
        const existing = snap.data() as EventDoc;
        const newVersion = (existing.version || 1) + 1;

        transaction.update(eventRef, {
          title: title.trim(),
          date: (date || '').trim(),
          open,
          version: newVersion,
          updatedAt: nowTimestamp,
          updatedBy: actorSub,
        });

        const auditLog: AuditDoc = {
          actorSub,
          action: 'event_update',
          eventId,
          version: newVersion,
          createdAt: nowTimestamp,
        };
        transaction.set(auditRef, auditLog);
      }
    });

    res.status(201).json({ id: eventId, ok: true });
  } catch (error) {
    console.error('Error saving event:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベントを保存できませんでした。',
      },
    });
  }
}

/**
 * PATCH /api/events/:id
 * イベント設定の更新（楽観的ロック version 照合、要認証）
 */
export async function patchEventHandler(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  const actorSub = req.adminUser?.sub || 'system';

  const parseResult = PatchEventSchema.safeParse(req.body);
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

  const { title, date, open, version } = parseResult.data;
  const db = getFirestore();
  const eventRef = db.collection(COLLECTION_EVENTS).doc(eventId);
  const auditRef = db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID());

  try {
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(eventRef);
      if (!snap.exists) {
        return { status: 404, code: 'EVENT_NOT_FOUND', message: 'イベントが見つかりません。' };
      }

      const existing = snap.data() as EventDoc;
      if (existing.version !== version) {
        return {
          status: 409,
          code: 'VERSION_CONFLICT',
          message: '他の管理者によりイベントが更新されています。最新の情報を再読み込みしてください。',
        };
      }

      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);
      const newVersion = existing.version + 1;

      const updateData: Partial<EventDoc> = {
        version: newVersion,
        updatedAt: nowTimestamp,
        updatedBy: actorSub,
      };

      if (title !== undefined) updateData.title = title.trim();
      if (date !== undefined) updateData.date = date.trim();
      if (open !== undefined) updateData.open = open;

      transaction.update(eventRef, updateData);

      const auditLog: AuditDoc = {
        actorSub,
        action: 'event_patch',
        eventId,
        version: newVersion,
        createdAt: nowTimestamp,
      };
      transaction.set(auditRef, auditLog);

      return {
        status: 200,
        event: formatEventResponse(eventId, { ...existing, ...updateData } as EventDoc),
      };
    });

    if (result.status === 200) {
      res.json(result.event);
      return;
    }

    res.status(result.status).json({
      error: {
        code: result.code,
        message: result.message,
      },
    });
  } catch (error) {
    console.error('Error patching event:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベントの更新に失敗しました。',
      },
    });
  }
}
