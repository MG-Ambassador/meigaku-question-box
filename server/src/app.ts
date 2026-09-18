import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requireAdminAuth } from './auth.js';
import { submitQuestionHandler } from './questions.js';
import {
  listPublicEventsHandler,
  getEventByIdHandler,
  listAdminEventsHandler,
  saveEventHandler,
  patchEventHandler,
} from './events.js';
import { getAdminMeHandler, getAdminReportHandler } from './report.js';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export function createApp() {
  const app = express();

  // リバースプロキシ（Google Cloud Run / Load Balancer）の信頼
  app.set('trust proxy', true);

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
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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

  // 生存確認エンドポイント
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  // 公開 API
  app.get('/api/events', listPublicEventsHandler);
  app.get('/api/events/:id', getEventByIdHandler);
  app.post('/api/questions', submitQuestionHandler);

  // 運営者専用 API（要認証）
  app.get('/api/admin/me', requireAdminAuth, getAdminMeHandler);
  app.get('/api/admin/events', requireAdminAuth, listAdminEventsHandler);
  app.get('/api/admin', requireAdminAuth, getAdminReportHandler);
  app.post('/api/events', requireAdminAuth, saveEventHandler);
  app.patch('/api/events/:id', requireAdminAuth, patchEventHandler);

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
