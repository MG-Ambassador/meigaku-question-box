import type { QuestionRow, ReportData } from './api-client';

export function appendReport(current: ReportData, page: ReportData): ReportData {
  const seen = new Set(current.rows.map((row) => row.id));
  const rows: QuestionRow[] = [...current.rows];
  for (const row of page.rows) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
  // Keep the original snapshot totals and collection time while paging.
  return { ...current, rows, hasNext: page.hasNext, nextCursor: page.nextCursor };
}

export function newQuestionCount(snapshot: ReportData, latest: ReportData): number {
  if (snapshot.filteredTotal !== undefined && latest.filteredTotal !== undefined) {
    return Math.max(0, latest.filteredTotal - snapshot.filteredTotal);
  }
  return Math.max(0, latest.total - snapshot.total);
}


/**
 * 自動更新で取り直した先頭ページ（新しい順）から、まだ一覧に無い質問を上に足す。
 * 件数・集計は新しい値にし、続きの読み込み位置（nextCursor）は今の一覧のものを残す。
 * 新着が1ページ分を超えて間が抜ける場合は null を返す（呼び出し側で一覧を取り直す）。
 */
export function prependNewRows(current: ReportData, fresh: ReportData): { report: ReportData; added: string[] } | null {
  if (current.rows.length === 0) return { report: fresh, added: fresh.rows.map((row) => row.id) };
  const seen = new Set(current.rows.map((row) => row.id));
  const added = fresh.rows.filter((row) => !seen.has(row.id));
  const overlaps = added.length < fresh.rows.length;
  if (!overlaps && fresh.hasNext) return null;
  return {
    report: {
      ...current,
      total: fresh.total,
      filteredTotal: fresh.filteredTotal,
      favoriteRevision: fresh.favoriteRevision ?? current.favoriteRevision,
      categories: fresh.categories,
      sources: fresh.sources,
      days: fresh.days,
      generatedAt: fresh.generatedAt,
      rows: [...added, ...current.rows],
    },
    added: added.map((row) => row.id),
  };
}
