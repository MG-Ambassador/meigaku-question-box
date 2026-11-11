/**
 * Cloud Run バックエンド API と通信するためのフロントエンドクライアント
 */

import { GUEST_TOKEN, guestFetch } from './guest-admin.ts';

export interface ApiErrorDetail {
  code: string;
  message: string;
  traceId?: string;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  traceId?: string;
  retryAfterSeconds?: number;

  constructor(statusCode: number, detail: ApiErrorDetail) {
    super(detail.message || `API Error: ${statusCode}`);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = detail.code || 'UNKNOWN_ERROR';
    this.traceId = detail.traceId;
    this.retryAfterSeconds = detail.retryAfterSeconds;
  }
}

export interface EventItem {
  id: string;
  title: string;
  date: string;
  open: number; // 1 or 0
  status?: 'active' | 'archived' | 'deleted';
  version?: number;
  created_at?: number;
  updated_at?: number;
}

export interface QuestionRow {
  id: string;
  body: string;
  category: string;
  categoryOrder?: number;
  source: string;
  created_at: number;
  sequence?: number;
  isFavorite?: boolean;
}

export interface ReportData {
  total: number;
  filteredTotal?: number;
  favoriteRevision?: number;
  pageSize: number;
  hasNext: boolean;
  nextCursor?: string | null;
  generatedAt: number;
  categories: { category: string; count: number }[];
  sources: { source: string; count: number }[];
  days: { day: string; count: number }[];
  rows: QuestionRow[];
}

export interface GetAdminReportOptions {
  pageSize?: number;
  cursor?: string | null;
  category?: string;
  sort?: 'newest' | 'oldest' | 'theme';
  favorite?: 'all' | 'favorite';
  day?: string;
  source?: 'web' | 'instagram';
}

export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * 汎用 fetch ラッパー
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string; timeoutMs?: number } = {}
): Promise<T> {
  // ゲスト管理者（開発確認用）: サーバーへ通信せずダミーデータで応答する
  if (options.token === GUEST_TOKEN) {
    return guestFetch<T>(path, { method: options.method, body: options.body });
  }
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${baseUrl}${normalizedPath}`;

  const { token, timeoutMs = 15000, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');

  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('通信がタイムアウトしました', 'TimeoutError')), timeoutMs);

  try {
    const response = await fetch(fullUrl, {
      ...requestOptions,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorDetail: ApiErrorDetail = {
        code: 'HTTP_ERROR',
        message: `通信エラーが発生しました (${response.status})`,
      };

      try {
        const data = (await response.json()) as { error?: ApiErrorDetail };
        if (data?.error) {
          errorDetail = data.error;
        }
      } catch {
        // JSONでない場合
      }

      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter && !errorDetail.retryAfterSeconds) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) {
          errorDetail.retryAfterSeconds = parsed;
        }
      }

      throw new ApiError(response.status, errorDetail);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/**
 * 公開：受付中イベント一覧を取得
 */
export async function getPublicEvents(signal?: AbortSignal): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/events', { signal });
}

export function getPublicEvent(id: string, signal?: AbortSignal): Promise<EventItem> {
  return apiFetch<EventItem>(`/api/events/${encodeURIComponent(id)}`, { signal });
}

/**
 * 公開：質問を送信（冪等な requestId を付与）
 */
export async function submitQuestion(params: {
  eventId: string;
  body: string;
  category: string;
  source: 'web' | 'instagram';
  requestId?: string;
}): Promise<{ ok: boolean; id: string; requestId: string }> {
  const requestId = params.requestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
  return apiFetch<{ ok: boolean; id: string; requestId: string }>('/api/questions', {
    method: 'POST',
    body: JSON.stringify({
      eventId: params.eventId,
      body: params.body,
      category: params.category,
      source: params.source,
      requestId,
    }),
  });
}

export type OperatorRole = 'owner' | 'operator';

export interface AdminUser {
  displayName: string;
  sub: string;
  loginId?: string;
  role?: OperatorRole;
  mustChange?: boolean;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: AdminUser;
}

export interface OperatorItem {
  loginId: string;
  displayName: string;
  role: OperatorRole;
  active: boolean;
  mustChange: boolean;
  createdAt: number;
}

/**
 * 運営：運営ID・パスワードでログインし、セッショントークンを受け取る
 */
export function login(loginId: string, password: string): Promise<AuthSession> {
  return apiFetch<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ loginId, password }),
  });
}

/**
 * 運営：サーバー側のセッションを無効化する
 */
export function logout(token: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST', token, body: '{}' });
}

/**
 * 運営：自分のパスワードを変更する（他端末のログインは無効になり、新しいトークンが返る）
 */
export function changePassword(token: string, currentPassword: string, newPassword: string): Promise<AuthSession> {
  return apiFetch<AuthSession>('/api/auth/password', {
    method: 'POST',
    token,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/**
 * 運営：セッショントークンで権限・表示名を確認
 */
export async function getAdminMe(token: string): Promise<AdminUser> {
  return apiFetch<AdminUser>('/api/admin/me', { token });
}

/**
 * 運営責任者：担当者一覧
 */
export function listOperators(token: string, signal?: AbortSignal): Promise<OperatorItem[]> {
  return apiFetch<OperatorItem[]>('/api/admin/operators', { token, signal });
}

/**
 * 運営責任者：担当者を追加（仮パスワードはこの応答でのみ受け取れる）
 */
export function createOperator(
  token: string,
  data: { loginId: string; displayName: string }
): Promise<{ loginId: string; displayName: string; temporaryPassword: string }> {
  return apiFetch('/api/admin/operators', { method: 'POST', token, body: JSON.stringify(data) });
}

/**
 * 運営責任者：仮パスワード再発行・利用停止・利用再開
 */
export function operatorAction(
  token: string,
  loginId: string,
  action: 'reset' | 'disable' | 'enable'
): Promise<{ ok: boolean; loginId: string; active: boolean; mustChange: boolean; temporaryPassword?: string }> {
  return apiFetch(`/api/admin/operators/${encodeURIComponent(loginId)}/${action}`, {
    method: 'POST',
    token,
    body: '{}',
  });
}

/**
 * 運営：全イベント一覧（閉鎖中含む）を取得
 */
export async function getAdminEvents(
  token: string,
  statusOrSignal?: 'active' | 'archived' | 'deleted' | AbortSignal,
  signal?: AbortSignal
): Promise<EventItem[]> {
  let status: 'active' | 'archived' | 'deleted' | undefined;
  let abortSignal = signal;
  if (statusOrSignal instanceof AbortSignal) {
    abortSignal = statusOrSignal;
  } else if (typeof statusOrSignal === 'string') {
    status = statusOrSignal;
  }
  const path = status ? `/api/admin/events?status=${encodeURIComponent(status)}` : '/api/admin/events';
  return apiFetch<EventItem[]>(path, { token, signal: abortSignal });
}

/**
 * 運営：イベントの集計および質問一覧を取得（フィルタ・ソート対応）
 */
export async function getAdminReport(
  token: string,
  eventId: string,
  pageSizeOrOptions: number | GetAdminReportOptions = 50,
  cursor?: string | null,
  signal?: AbortSignal
): Promise<ReportData> {
  const query = new URLSearchParams({ event: eventId });
  if (typeof pageSizeOrOptions === 'object') {
    const opts = pageSizeOrOptions;
    query.set('pageSize', String(opts.pageSize ?? 50));
    if (opts.cursor) query.set('cursor', opts.cursor);
    if (opts.category) query.set('category', opts.category);
    if (opts.sort) query.set('sort', opts.sort);
    if (opts.favorite && opts.favorite !== 'all') query.set('favorite', opts.favorite);
    if (opts.day) query.set('day', opts.day);
    if (opts.source) query.set('source', opts.source);
  } else {
    query.set('pageSize', String(pageSizeOrOptions));
    if (cursor) query.set('cursor', cursor);
  }
  return apiFetch<ReportData>(`/api/admin?${query.toString()}`, { token, signal });
}

export function toggleAdminQuestionFavorite(
  token: string,
  questionId: string,
  favorite: boolean
): Promise<{ ok: boolean; questionId: string; favorite: boolean }> {
  return apiFetch<{ ok: boolean; questionId: string; favorite: boolean }>(
    `/api/admin/questions/${encodeURIComponent(questionId)}/favorite`,
    {
      method: 'PUT',
      token,
      body: JSON.stringify({ favorite }),
    }
  );
}

export function changeAdminEventLifecycle(
  token: string,
  id: string,
  action: 'archive' | 'unarchive' | 'trash' | 'restore',
  version: number
): Promise<EventItem> {
  return apiFetch<EventItem>(`/api/events/${encodeURIComponent(id)}/lifecycle`, {
    method: 'POST',
    token,
    body: JSON.stringify({ action, version }),
  });
}

export function updateAdminEvent(
  token: string,
  id: string,
  data: { title: string; date: string; open: boolean; version: number },
): Promise<EventItem> {
  return apiFetch<EventItem>(`/api/events/${encodeURIComponent(id)}`, {
    method: 'PATCH', token, body: JSON.stringify(data),
  });
}

/**
 * 運営：イベントを作成または更新
 */
export async function saveAdminEvent(
  token: string,
  data: { id?: string; title: string; date?: string; open: boolean }
): Promise<{ id: string; ok: boolean }> {
  return apiFetch<{ id: string; ok: boolean }>('/api/events', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  });
}
