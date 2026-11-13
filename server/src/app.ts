import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requireAdminAuth, requirePermission, requireSession } from './auth.js';
import {
  loginHandler,
  logoutHandler,
  changePasswordHandler,
  listOperatorsHandler,
  createOperatorHandler,
  operatorActionHandler,
  changeOperatorRoleHandler,
} from './operators.js';
import { submitQuestionHandler } from './questions.js';
import {
  listPublicEventsHandler,
  getEventByIdHandler,
  listAdminEventsHandler,
  saveEventHandler,
  patchEventHandler,
  lifecycleEventHandler,
  emptyTrashHandler,
} from './events.js';
import {
  getAdminMeHandler,
  getAdminReportHandler,
  toggleQuestionFavoriteHandler,
} from './report.js';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export function createApp() {
  const app = express();

  // リバースプロキシ（Google Cloud Run = 1ホップ）の信頼段数を明示指定（無条件trueによる偽装を防止）
  const trustedProxyHops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  app.set('trust proxy', trustedProxyHops);

  // セキュリティヘッダー
  app.use(
    helmet({
      contentSecurityPolicy: false, // API専用サーバー
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS 設定
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsEnv
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // origin が未定義（curl、サーバー間、同一ホストなど）または開発時は許可
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== 'production') return callback(null, true);

        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS_NOT_ALLOWED'));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Retry-After'],
      credentials: true,
    })
  );

  // traceId の付与
  app.use((req, res, next) => {
    const traceId = crypto.randomUUID();
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    next();
  });

  // 8KiB ボディサイズ制限 JSON パーサー
  app.use(express.json({ limit: '8kb' }));

  // 生存確認。Cloud Runの予約パス（末尾z）との衝突を避ける。
  // https://cloud.google.com/run/docs/known-issues#reserved-url-paths
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  // 公開 API
  app.get('/api/events', listPublicEventsHandler);
  app.get('/api/events/:id', getEventByIdHandler);
  app.post('/api/questions', submitQuestionHandler);

  // 運営ログイン（ID・パスワード）
  app.post('/api/auth/login', loginHandler);
  app.post('/api/auth/logout', requireSession, logoutHandler);
  app.post('/api/auth/password', requireSession, changePasswordHandler);

  // 運営者専用 API（要認証）。/api/admin/me は初回パスワード変更前でも参照できる
  app.get('/api/admin/me', requireSession, getAdminMeHandler);
  const manageAccounts = requirePermission('accounts.manage');
  app.get('/api/admin/operators', requireAdminAuth, manageAccounts, listOperatorsHandler);
  app.post('/api/admin/operators', requireAdminAuth, manageAccounts, createOperatorHandler);
  // :action より先に登録する（/role を汎用アクションとして扱わせない）
  app.post('/api/admin/operators/:id/role', requireAdminAuth, manageAccounts, changeOperatorRoleHandler);
  app.post('/api/admin/operators/:id/:action', requireAdminAuth, manageAccounts, operatorActionHandler);
  app.get('/api/admin/events', requireAdminAuth, listAdminEventsHandler);
  app.get('/api/admin', requireAdminAuth, getAdminReportHandler);
  app.put('/api/admin/questions/:id/favorite', requireAdminAuth, toggleQuestionFavoriteHandler);
  app.post('/api/events', requireAdminAuth, requirePermission('room.manage'), saveEventHandler);
  // スタッフも受付の開始・終了はできる。タイトル・日付を変えたかどうかは patchEventHandler で見る。
  app.patch('/api/events/:id', requireAdminAuth, requirePermission('room.toggleOpen'), patchEventHandler);
  app.post('/api/events/:id/lifecycle', requireAdminAuth, requirePermission('room.manage'), lifecycleEventHandler);
  app.post('/api/admin/trash/empty', requireAdminAuth, requirePermission('trash.empty'), emptyTrashHandler);

  // 404 ハンドラ
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '指定されたエンドポイントは存在しません。',
      },
    });
  });

  // グローバルエラーハンドラ
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const traceId = req.traceId;

    if (err?.message === 'CORS_NOT_ALLOWED') {
      res.status(403).json({
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: '許可されていない送信元からのアクセスです。',
          traceId,
        },
      });
      return;
    }

    if (err?.type === 'entity.too.large' || err?.status === 413) {
      res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'リクエストデータが制限（8KB）を超えています。',
          traceId,
        },
      });
      return;
    }

    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'JSONフォーマットが不正です。',
          traceId,
        },
      });
      return;
    }

    console.error(`[Unhandled Error] traceId=${traceId}`, err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'サーバー内部でエラーが発生しました。',
        traceId,
      },
    });
  });

  return app;
}
