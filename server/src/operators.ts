import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { DocumentReference, Transaction } from '@google-cloud/firestore';
import {
  getFirestore,
  COLLECTION_OPERATORS,
  COLLECTION_AUDIT,
  Timestamp,
} from './firestore.js';
import {
  LoginSchema,
  PasswordChangeSchema,
  CreateOperatorSchema,
  ChangeOperatorRoleSchema,
  OPERATOR_ACTIONS,
  type AuditDoc,
  type OperatorAction,
  type OperatorDoc,
} from './types.js';
import {
  generateTemporaryPassword,
  hashPassword,
  normalizeLoginId,
  passwordValid,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './password.js';
import { issueSession, revokeAllSessions, revokeSession, toIdentity } from './sessions.js';
import {
  evaluateRateLimitInTransaction,
  extractClientIp,
  getScopedLimitDocRef,
  type RateLimitCheckResult,
  type RateLimitPolicy,
} from './rate-limit.js';
import { manageableRoles, normalizeRole, ROLE_LABELS } from './permissions.js';

/** 同一IPからのログイン試行: 10分30回 */
export const LOGIN_IP_LIMIT: RateLimitPolicy = { windowSeconds: 600, max: 30 };
/** 同一運営IDへのログイン試行: 15分10回 */
export const LOGIN_ID_LIMIT: RateLimitPolicy = { windowSeconds: 900, max: 10 };
/** パスワード変更の試行: 15分10回 */
export const PASSWORD_CHANGE_LIMIT: RateLimitPolicy = { windowSeconds: 900, max: 10 };

const INVALID_CREDENTIALS = '運営IDまたはパスワードが正しくありません。';
const LOGIN_ID_RULE = '運営IDは半角英数字・ハイフン・アンダーバーの3〜40文字で入力してください。';
const PASSWORD_RULE = `新しいパスワードは現在と異なる${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字で入力してください。`;

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function sendRateLimited(res: Response, retryAfterSeconds: number) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: '試行回数が多いため、しばらく待ってから再度お試しください。',
      retryAfterSeconds,
    },
  });
}

function unavailable(res: Response, error: unknown, message = '処理できませんでした。時間をおいて再度お試しください。') {
  console.error('Operator auth error:', error);
  sendError(res, 503, 'AUTH_UNAVAILABLE', message);
}

/** 許可された試行だけを記録し、いずれかが上限なら最長の待ち時間を返す */
function recordAttempts(
  transaction: Transaction,
  checks: { ref: DocumentReference; result: RateLimitCheckResult }[]
): number | null {
  let retryAfter: number | null = null;
  for (const { ref, result } of checks) {
    if (result.allowed) {
      transaction.set(ref, { acceptedAt: result.updatedAcceptedAt, expiresAt: result.expiresAt }, { merge: true });
    } else {
      retryAfter = Math.max(retryAfter ?? 0, result.retryAfterSeconds ?? 1);
    }
  }
  return retryAfter;
}

function audit(actorSub: string, action: string, targetId: string, version: number, now: Timestamp): AuditDoc {
  return { actorSub, action, eventId: '', targetId, version, createdAt: now };
}

/**
 * POST /api/auth/login
 * 運営ID・パスワードを検証し、セッショントークンを発行する。
 * 未登録ID・誤パスワード・利用停止はすべて同じ 401 応答とし、未登録IDでもハッシュ計算を行う。
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', '運営IDとパスワードを入力してください。');
    return;
  }

  const loginId = normalizeLoginId(parsed.data.loginId);
  const db = getFirestore();
  const now = new Date();

  try {
    const ipRef = getScopedLimitDocRef('auth-ip', extractClientIp(req));
    const idRef = loginId ? getScopedLimitDocRef('auth-id', loginId) : null;
    const operatorRef = loginId ? db.collection(COLLECTION_OPERATORS).doc(loginId) : null;

    const outcome = await db.runTransaction(async (transaction) => {
      const ipResult = await evaluateRateLimitInTransaction(transaction, ipRef, now, LOGIN_IP_LIMIT);
      const idResult = idRef ? await evaluateRateLimitInTransaction(transaction, idRef, now, LOGIN_ID_LIMIT) : null;
      const operatorSnap = operatorRef ? await transaction.get(operatorRef) : null;

      const checks = [{ ref: ipRef, result: ipResult }];
      if (idRef && idResult) checks.push({ ref: idRef, result: idResult });
      const retryAfter = recordAttempts(transaction, checks);

      return {
        retryAfter,
        operator: operatorSnap?.exists ? (operatorSnap.data() as OperatorDoc) : null,
      };
    });

    if (outcome.retryAfter !== null) {
      sendRateLimited(res, outcome.retryAfter);
      return;
    }

    const operator = outcome.operator;
    const valid = await verifyPassword(parsed.data.password, operator?.passwordHash);
    if (!valid || !loginId || !operator || operator.active !== true) {
      sendError(res, 401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
      return;
    }

    const session = await issueSession(loginId, operator.version, now);
    res.json({ ...session, user: toIdentity(loginId, operator) });
  } catch (error) {
    unavailable(res, error, '現在ログインできません。時間をおいて再度お試しください。');
  }
}

/**
 * POST /api/auth/logout
 * 現在のセッションを無効化する。
 */
export async function logoutHandler(req: Request, res: Response): Promise<void> {
  try {
    if (req.sessionHash) await revokeSession(req.sessionHash);
    res.json({ ok: true });
  } catch (error) {
    unavailable(res, error);
  }
}

/**
 * POST /api/auth/password
 * 自分のパスワードを変更する。全端末のセッションを無効化し、この端末には新しいセッションを発行する。
 */
export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const user = req.adminUser;
  if (!user) {
    sendError(res, 401, 'UNAUTHENTICATED', '認証が必要です。');
    return;
  }

  const parsed = PasswordChangeSchema.safeParse(req.body);
  if (!parsed.success || !passwordValid(parsed.data.newPassword) || parsed.data.newPassword === parsed.data.currentPassword) {
    sendError(res, 400, 'VALIDATION_ERROR', PASSWORD_RULE);
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const db = getFirestore();
  const operatorRef = db.collection(COLLECTION_OPERATORS).doc(user.loginId);
  const now = new Date();

  try {
    const limitRef = getScopedLimitDocRef('auth-change', user.loginId);
    const outcome = await db.runTransaction(async (transaction) => {
      const limitResult = await evaluateRateLimitInTransaction(transaction, limitRef, now, PASSWORD_CHANGE_LIMIT);
      const snap = await transaction.get(operatorRef);
      const retryAfter = recordAttempts(transaction, [{ ref: limitRef, result: limitResult }]);
      return { retryAfter, operator: snap.exists ? (snap.data() as OperatorDoc) : null };
    });

    if (outcome.retryAfter !== null) {
      sendRateLimited(res, outcome.retryAfter);
      return;
    }
    const current = outcome.operator;
    if (!current || current.active !== true) {
      sendError(res, 401, 'UNAUTHENTICATED', 'もう一度ログインしてください。');
      return;
    }
    if (!(await verifyPassword(currentPassword, current.passwordHash))) {
      sendError(res, 400, 'INVALID_CURRENT_PASSWORD', '現在のパスワードが正しくありません。');
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    const nowTimestamp = Timestamp.fromDate(now);
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(operatorRef);
      const latest = snap.exists ? (snap.data() as OperatorDoc) : null;
      if (!latest || latest.active !== true || latest.version !== current.version) return null;
      const version = latest.version + 1;
      transaction.update(operatorRef, { passwordHash, mustChange: false, version, updatedAt: nowTimestamp });
      transaction.set(
        db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID()),
        audit(user.loginId, 'operator_password_change', user.loginId, version, nowTimestamp)
      );
      return { ...latest, passwordHash, mustChange: false, version };
    });

    if (!result) {
      sendError(res, 409, 'ACCOUNT_CHANGED', 'アカウントが更新されました。ログインし直してください。');
      return;
    }

    await revokeAllSessions(user.loginId);
    const session = await issueSession(user.loginId, result.version, now);
    res.json({ ...session, user: toIdentity(user.loginId, result) });
  } catch (error) {
    unavailable(res, error, 'パスワードを変更できませんでした。時間をおいて再度お試しください。');
  }
}

/**
 * GET /api/admin/operators（owner 専用）
 */
export async function listOperatorsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const snap = await getFirestore().collection(COLLECTION_OPERATORS).get();
    const operators = snap.docs
      .map((doc) => {
        const data = doc.data() as OperatorDoc;
        return {
          loginId: doc.id,
          displayName: data.displayName,
          role: normalizeRole(data.role),
          active: data.active === true,
          mustChange: data.mustChange === true,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
    res.json(operators);
  } catch (error) {
    unavailable(res, error, '担当者を読み込めませんでした。');
  }
}

/**
 * POST /api/admin/operators（owner 専用）
 * 担当者を作成し、仮パスワードを一度だけ返す（DB にはハッシュのみ保存）。
 */
export async function createOperatorHandler(req: Request, res: Response): Promise<void> {
  const actor = req.adminUser!;
  const parsed = CreateOperatorSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || '入力内容を確認してください。');
    return;
  }
  const loginId = normalizeLoginId(parsed.data.loginId);
  if (!loginId) {
    sendError(res, 400, 'VALIDATION_ERROR', LOGIN_ID_RULE);
    return;
  }
  const displayName = parsed.data.displayName;
  const role = parsed.data.role;
  if (!manageableRoles(actor.role).includes(role)) {
    sendError(res, 403, 'FORBIDDEN', `${ROLE_LABELS[role]}のアカウントは作成できません。`);
    return;
  }

  try {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const db = getFirestore();
    const ref = db.collection(COLLECTION_OPERATORS).doc(loginId);
    const now = Timestamp.now();

    const created = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (snap.exists) return false;
      const doc: OperatorDoc = {
        loginId,
        displayName,
        passwordHash,
        role,
        active: true,
        mustChange: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(ref, doc);
      transaction.set(db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID()), audit(actor.loginId, 'operator_create', loginId, 1, now));
      return true;
    });

    if (!created) {
      sendError(res, 409, 'OPERATOR_EXISTS', 'この運営IDは既に使われています。');
      return;
    }
    res.status(201).json({ loginId, displayName, temporaryPassword });
  } catch (error) {
    unavailable(res, error, '担当者を追加できませんでした。');
  }
}

/**
 * POST /api/admin/operators/:id/:action（owner 専用）
 * reset: 仮パスワードを再発行 / disable: 利用停止 / enable: 利用再開。
 * いずれも version を進めて対象者の全セッションを無効化する。
 */
export async function operatorActionHandler(req: Request, res: Response): Promise<void> {
  const actor = req.adminUser!;
  const action = req.params.action as OperatorAction;
  if (!OPERATOR_ACTIONS.includes(action)) {
    sendError(res, 400, 'INVALID_ACTION', '操作を確認してください。');
    return;
  }
  const loginId = normalizeLoginId(req.params.id);
  if (!loginId) {
    sendError(res, 404, 'OPERATOR_NOT_FOUND', '担当者が見つかりません。');
    return;
  }
  if (loginId === actor.loginId) {
    sendError(res, 400, 'SELF_OPERATION', '自分自身の利用停止・再発行はできません。パスワード変更をご利用ください。');
    return;
  }

  try {
    const temporaryPassword = action === 'reset' ? generateTemporaryPassword() : undefined;
    const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : undefined;
    const db = getFirestore();
    const ref = db.collection(COLLECTION_OPERATORS).doc(loginId);
    const now = Timestamp.now();

    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return { status: 404, code: 'OPERATOR_NOT_FOUND', message: '担当者が見つかりません。' } as const;
      const current = snap.data() as OperatorDoc;
      if (!manageableRoles(actor.role).includes(normalizeRole(current.role))) {
        return { status: 403, code: 'FORBIDDEN', message: `${ROLE_LABELS[normalizeRole(current.role)]}のアカウントは変更できません。` } as const;
      }
      const version = current.version + 1;
      const update: Partial<OperatorDoc> = { version, updatedAt: now };
      if (action === 'reset') Object.assign(update, { passwordHash, mustChange: true });
      if (action === 'disable') update.active = false;
      if (action === 'enable') update.active = true;
      transaction.update(ref, update);
      transaction.set(db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID()), audit(actor.loginId, `operator_${action}`, loginId, version, now));
      return { status: 200, operator: { ...current, ...update } as OperatorDoc } as const;
    });

    if (result.status !== 200) {
      sendError(res, result.status, result.code, result.message);
      return;
    }

    await revokeAllSessions(loginId);
    res.json({
      ok: true,
      loginId,
      active: result.operator.active === true,
      mustChange: result.operator.mustChange === true,
      ...(temporaryPassword ? { temporaryPassword } : {}),
    });
  } catch (error) {
    unavailable(res, error, '担当者を更新できませんでした。');
  }
}

/**
 * POST /api/admin/operators/:id/role（アカウント管理権限）
 * 既存アカウントのロールを変更する。変更前・変更後のどちらのロールも操作者が管理できる範囲に限る。
 * version を進めて対象者の全セッションを無効化し、新しいロールで再ログインさせる。
 */
export async function changeOperatorRoleHandler(req: Request, res: Response): Promise<void> {
  const actor = req.adminUser!;
  const parsed = ChangeOperatorRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || 'ロールを選んでください。');
    return;
  }
  const role = parsed.data.role;
  const loginId = normalizeLoginId(req.params.id);
  if (!loginId) {
    sendError(res, 404, 'OPERATOR_NOT_FOUND', 'アカウントが見つかりません。');
    return;
  }
  if (loginId === actor.loginId) {
    sendError(res, 400, 'SELF_OPERATION', '自分自身のロールは変更できません。');
    return;
  }
  const allowed = manageableRoles(actor.role);
  if (!allowed.includes(role)) {
    sendError(res, 403, 'FORBIDDEN', `${ROLE_LABELS[role]}には変更できません。`);
    return;
  }

  try {
    const db = getFirestore();
    const ref = db.collection(COLLECTION_OPERATORS).doc(loginId);
    const now = Timestamp.now();

    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return { status: 404, code: 'OPERATOR_NOT_FOUND', message: 'アカウントが見つかりません。' } as const;
      const current = snap.data() as OperatorDoc;
      const currentRole = normalizeRole(current.role);
      if (!allowed.includes(currentRole)) {
        return { status: 403, code: 'FORBIDDEN', message: `${ROLE_LABELS[currentRole]}のアカウントは変更できません。` } as const;
      }
      if (current.role === role) return { status: 200, changed: false } as const;
      const version = current.version + 1;
      transaction.update(ref, { role, version, updatedAt: now });
      transaction.set(
        db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID()),
        audit(actor.loginId, `operator_role_${currentRole}_to_${role}`, loginId, version, now)
      );
      return { status: 200, changed: true } as const;
    });

    if (result.status !== 200) {
      sendError(res, result.status, result.code, result.message);
      return;
    }
    if (result.changed) await revokeAllSessions(loginId);
    res.json({ ok: true, loginId, role, changed: result.changed });
  } catch (error) {
    unavailable(res, error, 'ロールを変更できませんでした。');
  }
}
