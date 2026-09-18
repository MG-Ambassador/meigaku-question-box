/**
 * Cloud Run バックエンド API と通信するためのフロントエンドクライアント
 */

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
  version?: number;
  created_at?: number;
  updated_at?: number;
}

export interface QuestionRow {
  id: string;
  body: string;
  category: string;
  source: string;
  created_at: number;
  sequence?: number;
}

export interface ReportData {
  total: number;
  pageSize: number;
  hasNext: boolean;
  nextCursor?: string | null;
  generatedAt: number;
  categories: { category: string; count: number }[];
  sources: { source: string; count: number }[];
  days: { day: string; count: number }[];
  rows: QuestionRow[];
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
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${baseUrl}${normalizedPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers,
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
}

/**
 * 公開：受付中イベント一覧を取得
 */
export async function getPublicEvents(): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/events');
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

/**
 * 運営：Google IDトークンで権限・表示名を確認
 */
export async function getAdminMe(token: string): Promise<{ displayName: string; sub: string; email?: string }> {
  return apiFetch<{ displayName: string; sub: string; email?: string }>('/api/admin/me', { token });
}

/**
 * 運営：全イベント一覧（閉鎖中含む）を取得
 */
export async function getAdminEvents(token: string): Promise<EventItem[]> {
  return apiFetch<EventItem[]>('/api/admin/events', { token });
}

/**
 * 運営：イベントの集計および質問一覧を取得
 */
export async function getAdminReport(
  token: string,
  eventId: string,
  pageSize = 50
): Promise<ReportData> {
  const query = new URLSearchParams({
    event: eventId,
    pageSize: String(pageSize),
  });
  return apiFetch<ReportData>(`/api/admin?${query.toString()}`, { token });
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
