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
  EventLifecycleSchema,
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
    status: doc.status || 'active',
    version: doc.version,
    created_at: doc.createdAt?.toMillis() || Date.now(),
    updated_at: doc.updatedAt?.toMillis() || Date.now(),
  };
}

/**
 * GET /api/events
 * 公開用：受付中のイベント一覧を返す（最新作成順、active かつ open のみ）
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
      .filter((e) => e.status === 'active' && e.open === 1)
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
 * 単一イベントの詳細（公開メタデータ、削除済みは404）
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
    if (data.status === 'deleted') {
      res.status(404).json({
        error: {
          code: 'EVENT_NOT_FOUND',
          message: '指定されたイベントは利用できません。',
        },
      });
      return;
    }

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
 * 管理用：イベント一覧（要認証、?status=active|archived|deleted で絞り込み可能）
 */
export async function listAdminEventsHandler(req: Request, res: Response): Promise<void> {
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
  try {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTION_EVENTS).get();

    let events = snapshot.docs
      .map((doc) => formatEventResponse(doc.id, doc.data() as EventDoc))
      .sort((a, b) => b.created_at - a.created_at);

    if (statusFilter && ['active', 'archived', 'deleted'].includes(statusFilter)) {
      events = events.filter((e) => e.status === statusFilter);
    }

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
          status: 'active',
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
        if (existing.status === 'deleted') {
          throw new Error('DELETED_EVENT');
        }
        if (existing.status === 'archived' && open) {
          throw new Error('CANNOT_REOPEN_ARCHIVED');
        }

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
  } catch (error: any) {
    if (error?.message === 'DELETED_EVENT') {
      res.status(400).json({ error: { code: 'EVENT_DELETED', message: '削除されたイベントは変更できません。' } });
      return;
    }
    if (error?.message === 'CANNOT_REOPEN_ARCHIVED') {
      res.status(400).json({ error: { code: 'INVALID_TRANSITION', message: 'アーカイブ済みイベントの受付は直接再開できません。' } });
      return;
    }
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
      if (existing.status === 'deleted') {
        return { status: 400, code: 'EVENT_DELETED', message: '削除されたイベントは変更できません。' };
      }
      if (existing.status === 'archived' && open === true) {
        return { status: 400, code: 'INVALID_TRANSITION', message: 'アーカイブ済みイベントの受付を直接再開することはできません。通常状態へ戻してください。' };
      }
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

/**
 * POST /api/events/:id/lifecycle
 * イベントの状態変更（active <-> archived -> deleted -> archived）
 */
export async function lifecycleEventHandler(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  const actorSub = req.adminUser?.sub || 'system';

  const parseResult = EventLifecycleSchema.safeParse(req.body);
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

  const { action, version } = parseResult.data;
  const db = getFirestore();
  const eventRef = db.collection(COLLECTION_EVENTS).doc(eventId);
  const eventStatsRef = db.collection(COLLECTION_EVENT_STATS).doc(eventId);
  const auditRef = db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID());

  try {
    const result = await db.runTransaction(async (transaction) => {
      const [snap, statsSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(eventStatsRef),
      ]);

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

      const currentStatus = existing.status || 'active';
      let nextStatus: 'active' | 'archived' | 'deleted';
      let nextOpen = existing.open;

      switch (action) {
        case 'archive':
          if (currentStatus !== 'active') {
            return { status: 400, code: 'INVALID_TRANSITION', message: '通常イベントのみアーカイブできます。' };
          }
          nextStatus = 'archived';
          nextOpen = false;
          break;
        case 'unarchive':
          if (currentStatus !== 'archived') {
            return { status: 400, code: 'INVALID_TRANSITION', message: 'アーカイブ済みイベントのみ通常に戻せます。' };
          }
          nextStatus = 'active';
          nextOpen = false; // 通常に戻しても受付は再開しない
          break;
        case 'trash':
          if (currentStatus === 'deleted') {
            return { status: 400, code: 'INVALID_TRANSITION', message: '既にごみ箱に移動されています。' };
          }
          nextStatus = 'deleted';
          nextOpen = false;
          break;
        case 'restore':
          if (currentStatus !== 'deleted') {
            return { status: 400, code: 'INVALID_TRANSITION', message: 'ごみ箱のイベントのみ復元できます。' };
          }
          nextStatus = 'archived'; // ごみ箱からの復元先はアーカイブ
          nextOpen = false;
          break;
        default:
          return { status: 400, code: 'INVALID_ACTION', message: '不正なアクションです。' };
      }

      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);
      const newVersion = existing.version + 1;

      transaction.update(eventRef, {
        status: nextStatus,
        open: nextOpen,
        version: newVersion,
        updatedAt: nowTimestamp,
        updatedBy: actorSub,
      });

      // 既存のcursorを失効させるため、eventStatsのdataVersionをインクリメント
      if (statsSnap.exists) {
        const statsData = statsSnap.data() as EventStatsDoc;
        transaction.update(eventStatsRef, {
          dataVersion: (statsData.dataVersion || 1) + 1,
          updatedAt: nowTimestamp,
        });
      }

      const auditLog: AuditDoc = {
        actorSub,
        action: `event_${action}`,
        eventId,
        version: newVersion,
        createdAt: nowTimestamp,
      };
      transaction.set(auditRef, auditLog);

      return {
        status: 200,
        event: formatEventResponse(eventId, {
          ...existing,
          status: nextStatus,
          open: nextOpen,
          version: newVersion,
          updatedAt: nowTimestamp,
        } as EventDoc),
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
    console.error('Error in event lifecycle:', error);
    res.status(503).json({
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'イベント状態の更新に失敗しました。',
      },
    });
  }
}
