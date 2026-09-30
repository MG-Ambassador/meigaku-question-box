import type { QuestionRow, ReportData } from './api-client';

export function appendReport(current: ReportData, page: ReportData): ReportData {
  const seen = new Set(current.rows.map((row) => row.id));
  const rows: QuestionRow[] = [...current.rows];
  for (const row of page.rows) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
  // Keep the original snapshot totals and collection time while paging.
  return { ...current, rows, hasNext: page.hasNext, nextCursor: page.nextCursor };
}

export function newQuestionCount(snapshot: ReportData, latest: ReportData): number {
  return Math.max(0, latest.total - snapshot.total);
}
