import type { Request, Response, NextFunction } from 'express';
import type { AdminIdentity } from './types.js';
import { resolveSession } from './sessions.js';
import { can, type Permission } from './permissions.js';

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminIdentity;
      /** 現在のセッショントークンの SHA-256（ログアウト・パスワード変更で使用） */
      sessionHash?: string;
    }
  }
}

/**
 * 本番環境（NODE_ENV === 'production'）における必須環境変数の設定状態を検証する。
 * 未設定またはデフォルト値のままでの本番起動を防止する（Fail-fast）。
 */
export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];

  if (
    !process.env.RATE_LIMIT_SECRET?.trim() ||
    process.env.RATE_LIMIT_SECRET === 'meigaku-question-box-default-secret-key'
  ) {
    missing.push('RATE_LIMIT_SECRET');
  }
  if (
    !process.env.CURSOR_SECRET?.trim() ||
    process.env.CURSOR_SECRET === 'meigaku-question-box-cursor-secret-key'
  ) {
    missing.push('CURSOR_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `[FATAL] Required production environment variables are missing or insecure: ${missing.join(', ')}`
    );
  }
}

function unauthenticated(res: Response, message = '認証が必要です。運営IDとパスワードでログインしてください。') {
  res.status(401).json({ error: { code: 'UNAUTHENTICATED', message } });
}

async function authenticate(req: Request, res: Response): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    unauthenticated(res);
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    unauthenticated(res);
    return false;
  }

  try {
    const session = await resolveSession(token);
    if (!session) {
      unauthenticated(res, 'ログインの有効期限が切れたか、無効になりました。再度ログインしてください。');
      return false;
    }
    req.adminUser = session.identity;
    req.sessionHash = session.tokenHash;
    return true;
  } catch (error) {
    console.error('Error resolving operator session:', error);
    res.status(503).json({
      error: { code: 'AUTH_UNAVAILABLE', message: 'ログイン状態を確認できませんでした。時間をおいて再度お試しください。' },
    });
    return false;
  }
}

/**
 * 有効なセッションであれば通す（初回パスワード変更前でも可）。
 * /api/admin/me・パスワード変更・ログアウトでのみ使う。
 */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await authenticate(req, res)) next();
}

/**
 * 運営 API 用。有効なセッションで、かつ初回パスワード変更が済んでいる運営者のみ通す。
 */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await authenticate(req, res))) return;
  if (req.adminUser?.mustChange) {
    res.status(403).json({
      error: { code: 'PASSWORD_CHANGE_REQUIRED', message: '初回ログイン時はパスワードの変更が必要です。' },
    });
    return;
  }
  next();
}

const PERMISSION_MESSAGES: Record<Permission, string> = {
  'room.toggleOpen': 'この操作の権限がありません。',
  'room.manage': 'ルームの作成・編集はできません（スタッフは受付の開始・終了だけ操作できます）。',
  'trash.empty': 'ごみ箱を空にできるのは開発者・責任者だけです。',
  'accounts.manage': 'アカウント管理は開発者・責任者だけが利用できます。',
  'devtools': '開発者だけが利用できます。',
};

/** ロールに権限があれば通す。requireAdminAuth の後に置く（ロールの一覧は permissions.ts） */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!can(req.adminUser?.role, permission)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: PERMISSION_MESSAGES[permission] } });
      return;
    }
    next();
  };
}
