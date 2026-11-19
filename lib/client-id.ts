/**
 * 来場者の端末ID。サーバーの「端末ごとの投稿制限」に使う。
 * ブラウザで作ったランダムな UUID を localStorage に保存するだけで、個人を特定する情報は含まない。
 * サーバー側では HMAC 化してから保存する。
 */
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const CLIENT_ID_KEY = 'mga:client-id:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let memoryId: string | null = null;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 保存済みの端末IDを返す。無ければ作って保存する。
 * 保存できない環境（プライベートブラウズ等）では、ページを開いている間だけ同じIDを使う。
 */
export function getClientId(
  storage: KeyValueStorage | null = defaultStorage(),
  create: () => string = () => crypto.randomUUID()
): string {
  try {
    const saved = storage?.getItem(CLIENT_ID_KEY);
    if (saved && UUID.test(saved)) return saved;
  } catch {
    /* Storage may be unavailable */
  }
  const id = memoryId && UUID.test(memoryId) ? memoryId : create();
  memoryId = id;
  try {
    storage?.setItem(CLIENT_ID_KEY, id);
  } catch {
    /* Storage may be unavailable */
  }
  return id;
}
