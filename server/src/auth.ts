import type { Request, Response, NextFunction } from 'express';
import type { AdminIdentity } from './types.js';

let client: any = null;
async function getOAuthClient(): Promise<any> {
  if (!client) {
    const { OAuth2Client } = await import('google-auth-library');
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    client = new OAuth2Client(clientId);
  }
  return client;
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminIdentity;
    }
  }
}

/**
 * 環境変数 ADMIN_IDENTITIES から許可された管理者リストを読み込む
 * JSON配列例: [{"sub":"123456789","displayName":"運営管理者","email":"admin@example.com"}]
 * または単純なカンマ区切り sub リスト
 */
export function getAllowedAdmins(): AdminIdentity[] {
  const envVal = process.env.ADMIN_IDENTITIES;
  if (!envVal) return [];

  try {
    const parsed = JSON.parse(envVal);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        if (typeof item === 'string') {
          return { sub: item, displayName: '運営担当者' };
        }
        return {
          sub: String(item.sub),
          displayName: String(item.displayName || '運営担当者'),
          email: item.email ? String(item.email) : undefined,
        };
      });
    }
  } catch {
    // カンマ区切りの文字列フォールバック
    return envVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sub) => ({ sub, displayName: '運営担当者' }));
  }

  return [];
}

/**
 * 本番環境（NODE_ENV === 'production'）における必須環境変数の設定状態を検証する。
 * 未設定またはデフォルト値のままでの本番起動を防止する（Fail-fast）。
 */
export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];

  if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (getAllowedAdmins().length === 0) {
    missing.push('ADMIN_IDENTITIES');
  }
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

/**
 * Google ID トークンを検証し、許可された運営者であることを確認する Express ミドルウェア
 */
export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: '認証が必要です。Googleアカウントでログインしてください。',
      },
    });
    return;
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: '認証トークンが空です。',
      },
    });
    return;
  }

  // テスト用バイパス
  if (
    (process.env.NODE_ENV === 'test' || process.env.ALLOW_TEST_AUTH === 'true') &&
    idToken.startsWith('test-token-')
  ) {
    const sub = idToken.replace('test-token-', '');
    const allowed = getAllowedAdmins().find((a) => a.sub === sub);
    if (!allowed) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'このGoogleアカウントには運営権限がありません。',
        },
      });
      return;
    }
    req.adminUser = allowed;
    next();
    return;
  }

  try {
    const oauthClient = await getOAuthClient();
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID || '',
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'トークンの検証に失敗しました。',
        },
      });
      return;
    }

    if (!payload.email_verified) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'メールアドレスが確認されていないアカウントです。',
        },
      });
      return;
    }

    const sub = payload.sub;
    const allowed = getAllowedAdmins().find((a) => a.sub === sub);

    if (!allowed) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'このアカウントには運営画面のアクセス権限がありません。',
        },
      });
      return;
    }

    req.adminUser = {
      sub: allowed.sub,
      displayName: allowed.displayName || payload.name || '運営担当者',
      email: payload.email,
    };

    next();
  } catch (error) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Googleログインの有効期限が切れたか、トークンが無効です。再度ログインしてください。',
      },
    });
  }
}
