/**
 * 運営ログインのセッショントークン保存（sessionStorage）。
 * タブを閉じると消え、再読み込みでは維持される。有効期限の判定はサーバー側が正で、
 * ここでの期限チェックは期限切れトークンで無駄な通信をしないためのもの。
 */
export type StoredSession = { token: string; expiresAt: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'mga:admin-session:v1';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSession(storage: StorageLike | null = defaultStorage(), now = Date.now()): StoredSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredSession;
    if (typeof value?.token !== 'string' || !TOKEN_PATTERN.test(value.token) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= now) throw new Error('invalid session');
    return { token: value.token, expiresAt: value.expiresAt };
  } catch {
    clearSession(storage);
    return null;
  }
}

export function writeSession(session: StoredSession, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
