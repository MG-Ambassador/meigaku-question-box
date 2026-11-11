/**
 * ゲスト管理者モード（開発確認用）
 *
 * ブラウザ内のダミーデータだけで運営管理画面を操作できるようにする。
 * - サーバーへは一切通信しない（本物の管理 API・Firestore には触れない）
 * - 変更はメモリ上のみで、ページを再読み込みすると初期状態に戻る
 * - 非表示にするには NEXT_PUBLIC_ENABLE_GUEST_ADMIN=false を指定してビルドする
 */
import { ApiError, type EventItem, type QuestionRow, type ReportData } from './api-client.ts';

export const GUEST_TOKEN = '__guest_admin__';
// ゲストは一般担当者扱い（担当者管理・パスワード変更は表示しない）
export const GUEST_USER = {
  displayName: 'ゲスト管理者',
  sub: 'guest-admin',
  loginId: 'guest-admin',
  role: 'operator',
  mustChange: false,
} as const;

export function isGuestAdminEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_GUEST_ADMIN !== 'false';
}

const CATEGORIES = ['大学生活', '学び・授業', '入試・進路', '留学・国際交流', 'その他'];
const SAMPLE_BODIES: Record<string, string[]> = {
  '大学生活': ['サークルはどのくらいの種類がありますか？', '学食のおすすめメニューを教えてください。', '一人暮らしの学生は多いですか？'],
  '学び・授業': ['履修登録は自由度が高いですか？', 'ゼミはいつから始まりますか？', '他学部の授業も取れますか？'],
  '入試・進路': ['総合型選抜の対策で大切なことは？', '就職支援はどんなものがありますか？', '指定校推薦の枠はありますか？'],
  '留学・国際交流': ['交換留学の費用はどのくらいですか？', '語学力はどの程度必要ですか？'],
  'その他': ['キャンパスは見学できますか？', 'アクセスで便利な駅はどこですか？'],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayJst = (ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(ms));

interface GuestQuestion extends QuestionRow { eventId: string }

let events: EventItem[] = [];
let questions: GuestQuestion[] = [];
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  const now = Date.now();
  events = [
    { id: 'guest-open-campus', title: '【ダミー】オープンキャンパス', date: '2026年8月 白金キャンパス', open: 1, status: 'active', version: 1, created_at: now - 5 * DAY_MS, updated_at: now - 5 * DAY_MS },
    { id: 'guest-festival', title: '【ダミー】学園祭 質問ブース', date: '2026年11月', open: 0, status: 'active', version: 1, created_at: now - 9 * DAY_MS, updated_at: now - 9 * DAY_MS },
    { id: 'guest-archived', title: '【ダミー】昨年のイベント', date: '2025年8月', open: 0, status: 'archived', version: 2, created_at: now - 90 * DAY_MS, updated_at: now - 60 * DAY_MS },
    { id: 'guest-trashed', title: '【ダミー】テスト用の部屋', date: '', open: 0, status: 'deleted', version: 3, created_at: now - 120 * DAY_MS, updated_at: now - 100 * DAY_MS },
  ];
  questions = [];
  for (const [eventIndex, event] of events.slice(0, 3).entries()) {
    const count = eventIndex === 0 ? 36 : eventIndex === 1 ? 8 : 5;
    for (let i = 0; i < count; i += 1) {
      const category = CATEGORIES[(i + eventIndex) % CATEGORIES.length];
      const bodies = SAMPLE_BODIES[category];
      const createdAt = now - i * 3.7 * 60 * 60 * 1000 - eventIndex * DAY_MS;
      questions.push({
        eventId: event.id,
        id: `${event.id}-q${i + 1}`,
        body: bodies[i % bodies.length],
        category,
        categoryOrder: CATEGORIES.indexOf(category),
        source: i % 4 === 0 ? 'instagram' : 'web',
        created_at: createdAt,
        sequence: count - i,
        isFavorite: i % 7 === 0,
      });
    }
  }
}

function notFound(): never {
  throw new ApiError(404, { code: 'EVENT_NOT_FOUND', message: 'イベントが見つかりません。' });
}

function conflict(): never {
  throw new ApiError(409, { code: 'VERSION_CONFLICT', message: '他の管理者によりイベントが更新されています。最新の情報を再読み込みしてください。' });
}

function report(params: URLSearchParams): ReportData {
  const eventId = params.get('event') || '';
  const event = events.find((e) => e.id === eventId);
  if (!event) notFound();
  if (event.status === 'deleted') {
    throw new ApiError(404, { code: 'EVENT_DELETED', message: 'ごみ箱の部屋の質問は表示できません。' });
  }
  const all = questions.filter((q) => q.eventId === eventId);
  const category = params.get('category');
  const source = params.get('source');
  const day = params.get('day');
  const favorite = params.get('favorite');
  const sort = params.get('sort') || 'newest';

  const filtered = all.filter((q) =>
    (!category || q.category === category) &&
    (!source || q.source === source) &&
    (!day || dayJst(q.created_at) === day) &&
    (!favorite || favorite === 'all' || q.isFavorite));
  filtered.sort((a, b) =>
    sort === 'oldest' ? a.sequence! - b.sequence!
      : sort === 'theme' ? a.categoryOrder! - b.categoryOrder! || b.sequence! - a.sequence!
        : b.sequence! - a.sequence!);

  const count = <K extends string>(key: (q: GuestQuestion) => K) => {
    const map = new Map<K, number>();
    for (const q of all) map.set(key(q), (map.get(key(q)) || 0) + 1);
    return [...map.entries()];
  };
  return {
    total: all.length,
    filteredTotal: filtered.length,
    favoriteRevision: 0,
    pageSize: Number(params.get('pageSize')) || 50,
    hasNext: false,
    nextCursor: null,
    generatedAt: Date.now(),
    categories: count((q) => q.category).map(([category, n]) => ({ category, count: n }))
      .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)),
    sources: count((q) => q.source).map(([source, n]) => ({ source, count: n })),
    days: count((q) => dayJst(q.created_at)).map(([day, n]) => ({ day, count: n })).sort((a, b) => b.day.localeCompare(a.day)),
    rows: filtered.map((q) => ({
      id: q.id, body: q.body, category: q.category, categoryOrder: q.categoryOrder,
      source: q.source, created_at: q.created_at, sequence: q.sequence, isFavorite: q.isFavorite,
    })),
  };
}

/** apiFetch の代わりに呼ばれる、ダミーデータ向けの擬似 API */
export async function guestFetch<T>(path: string, init: { method?: string; body?: BodyInit | null } = {}): Promise<T> {
  init_();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const url = new URL(path, 'http://guest.local');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const p = url.pathname;

  if (method === 'GET' && p === '/api/admin/me') return { ...GUEST_USER } as T;
  if (method === 'POST' && p === '/api/auth/logout') return { ok: true } as T;

  if (method === 'GET' && p === '/api/admin/events') {
    const status = url.searchParams.get('status');
    return events.filter((e) => !status || (e.status || 'active') === status)
      .sort((a, b) => b.created_at! - a.created_at!).map((e) => ({ ...e })) as T;
  }

  if (method === 'GET' && p === '/api/admin') return report(url.searchParams) as T;

  let m = p.match(/^\/api\/admin\/questions\/([^/]+)\/favorite$/);
  if (m && method === 'PUT') {
    const q = questions.find((x) => x.id === decodeURIComponent(m![1]));
    if (!q) throw new ApiError(404, { code: 'QUESTION_NOT_FOUND', message: '質問が見つかりません。' });
    q.isFavorite = !!body.favorite;
    return { ok: true, questionId: q.id, favorite: q.isFavorite } as T;
  }

  m = p.match(/^\/api\/events\/([^/]+)\/lifecycle$/);
  if (m && method === 'POST') {
    const event = events.find((e) => e.id === decodeURIComponent(m![1])) ?? notFound();
    if (event.version !== body.version) conflict();
    const next = { archive: 'archived', unarchive: 'active', trash: 'deleted', restore: 'archived' }[body.action as string] as EventItem['status'];
    if (!next) throw new ApiError(400, { code: 'INVALID_ACTION', message: '不正なアクションです。' });
    Object.assign(event, { status: next, open: 0, version: event.version! + 1, updated_at: Date.now() });
    return { ...event } as T;
  }

  m = p.match(/^\/api\/events\/([^/]+)$/);
  if (m && method === 'PATCH') {
    const event = events.find((e) => e.id === decodeURIComponent(m![1])) ?? notFound();
    if (event.version !== body.version) conflict();
    if (event.status === 'archived' && body.open === true) {
      throw new ApiError(400, { code: 'INVALID_TRANSITION', message: 'アーカイブ済みイベントの受付を直接再開することはできません。通常状態へ戻してください。' });
    }
    if (typeof body.title === 'string') event.title = body.title.trim();
    if (typeof body.date === 'string') event.date = body.date.trim();
    if (typeof body.open === 'boolean') event.open = body.open ? 1 : 0;
    event.version = event.version! + 1;
    event.updated_at = Date.now();
    return { ...event } as T;
  }

  if (method === 'POST' && p === '/api/events') {
    const id = body.id || `guest-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    events.unshift({ id, title: String(body.title || '').trim(), date: String(body.date || '').trim(), open: body.open ? 1 : 0, status: 'active', version: 1, created_at: now, updated_at: now });
    return { id, ok: true } as T;
  }

  throw new ApiError(404, { code: 'NOT_FOUND', message: 'ゲストモードでは利用できない操作です。' });
}

function init_() { init(); }
