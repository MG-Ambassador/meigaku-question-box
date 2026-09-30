/**
 * GitHub Pages 等の basePath を考慮した公開パス解決ヘルパー
 */

export function getBasePath(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  if (base.endsWith('/')) {
    return base.slice(0, -1);
  }
  return base;
}

/**
 * 相対パスを受け取り、basePath を付与したパスを返す
 * 例: resolvePublicPath('/admin/') -> '/MGA/admin/'
 */
export function resolvePublicPath(path: string): string {
  const basePath = getBasePath();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}

/**
 * 募集URLなどの完全修飾URLを生成する
 */
export function getRecruitmentUrl(eventId: string, source: 'web' | 'instagram' = 'web'): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const path = resolvePublicPath('/');
  const cleanPath = path.endsWith('/') ? path : `${path}/`;
  return `${origin}${cleanPath}?event=${encodeURIComponent(eventId)}${source === 'instagram' ? '&from=instagram' : ''}`;
}
