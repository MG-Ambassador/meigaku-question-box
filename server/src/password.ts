import crypto from 'node:crypto';

/**
 * 運営アカウントのパスワード処理。
 * OWASP の scrypt 推奨値（N=2^14, r=8, p=5）。salt とコストはハッシュ文字列に含める。
 * 形式: scrypt$16384$8$5$<salt 32hex>$<hash 64hex>（旧 D1 版 lib/password-auth.ts と同じ）
 */
const N = 16384;
const R = 8;
const P = 5;
const KEY_LENGTH = 32;
const PREFIX = `scrypt$${N}$${R}$${P}$`;
const HASH_PATTERN = /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
// 未登録IDでも同じ計算量をかけ、応答時間からIDの有無を推測させない
const DUMMY_HASH = `${PREFIX}${'0'.repeat(32)}$${'0'.repeat(64)}`;

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 32 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): Promise<string> {
  const key = await derive(password, salt);
  return `${PREFIX}${salt}$${key.toString('hex')}`;
}

/** 形式が不正なハッシュ（未登録IDなど）でも計算を行い、必ず false を返す */
export async function verifyPassword(password: string, encoded: string | undefined | null): Promise<boolean> {
  const match = HASH_PATTERN.exec(encoded || '');
  const [, salt, expected] = match || HASH_PATTERN.exec(DUMMY_HASH)!;
  const actual = await derive(password, salt);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex')) && !!match;
}

export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

/** 半角英数字・ハイフン・アンダーバー 3〜40 文字。小文字に正規化する。不正なら null */
export function normalizeLoginId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(value) ? value.toLowerCase() : null;
}

/** 文字数はコードポイント単位で数える（絵文字等を1文字として扱う） */
export function passwordValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH
  );
}

/** 仮パスワード（24文字・URLセーフ）。初回ログイン後に本人が変更する */
export function generateTemporaryPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
