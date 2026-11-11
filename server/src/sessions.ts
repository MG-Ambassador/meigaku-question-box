import crypto from 'node:crypto';
import {
  getFirestore,
  COLLECTION_OPERATORS,
  COLLECTION_OPERATOR_SESSIONS,
  Timestamp,
} from './firestore.js';
import type { AdminIdentity, OperatorDoc, OperatorSessionDoc } from './types.js';

/** セッションの有効期間（ログインから8時間。延長はしない） */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function toIdentity(loginId: string, doc: OperatorDoc): AdminIdentity {
  return {
    sub: loginId,
    loginId,
    displayName: doc.displayName,
    role: doc.role,
    mustChange: doc.mustChange === true,
  };
}

/**
 * セッションを発行する。DB にはトークンの SHA-256 だけを保存し、トークン本体は呼び出し元へ一度だけ返す。
 * operator の version を記録し、パスワード変更・再発行・利用停止（version+1）で自動的に無効になる。
 */
export async function issueSession(
  operatorId: string,
  version: number,
  now = new Date()
): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now.getTime() + SESSION_TTL_MS;
  const doc: OperatorSessionDoc = {
    operatorId,
    version,
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromMillis(expiresAt),
  };
  await getFirestore().collection(COLLECTION_OPERATOR_SESSIONS).doc(hashToken(token)).set(doc);
  return { token, expiresAt };
}

/** トークンを検証し、有効な運営者を返す。無効・期限切れ・停止・資格情報変更後は null */
export async function resolveSession(
  token: string,
  now = Date.now()
): Promise<{ identity: AdminIdentity; tokenHash: string; expiresAt: number } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const db = getFirestore();
  const tokenHash = hashToken(token);
  const sessionSnap = await db.collection(COLLECTION_OPERATOR_SESSIONS).doc(tokenHash).get();
  if (!sessionSnap.exists) return null;
  const session = sessionSnap.data() as OperatorSessionDoc;
  const expiresAt = session.expiresAt?.toMillis?.() ?? 0;
  if (expiresAt <= now) return null;

  const operatorSnap = await db.collection(COLLECTION_OPERATORS).doc(session.operatorId).get();
  if (!operatorSnap.exists) return null;
  const operator = operatorSnap.data() as OperatorDoc;
  if (operator.active !== true || operator.version !== session.version) return null;

  return { identity: toIdentity(session.operatorId, operator), tokenHash, expiresAt };
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await getFirestore().collection(COLLECTION_OPERATOR_SESSIONS).doc(tokenHash).delete();
}

/**
 * 対象者の全セッション文書を削除する（後片付け）。
 * 無効化そのものは version の更新で既に成立しているため、失敗しても安全側。
 */
export async function revokeAllSessions(operatorId: string, exceptHash?: string): Promise<void> {
  try {
    const db = getFirestore();
    const snap = await db.collection(COLLECTION_OPERATOR_SESSIONS).where('operatorId', '==', operatorId).get();
    await Promise.all(
      snap.docs.filter((doc) => doc.id !== exceptHash).map((doc) => doc.ref.delete())
    );
  } catch (error) {
    console.error('Failed to clean up operator sessions:', error);
  }
}
