export const CATEGORIES = ['大学生活', '学び・授業', '入試・進路', '留学・国際交流', 'その他'] as const;
export type Category = typeof CATEGORIES[number];
export type Submission = { eventId: string; body: string; category: Category; source: 'web' | 'instagram'; requestId: string };
export type Draft = { body: string; category: Category; pending?: Submission; retryAt?: number; savedAt: number };
export const DRAFT_TTL = 2 * 60 * 60 * 1000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (eventId: string) => `mga:draft:v1:${eventId}`;

export function emptyDraft(): Draft { return { body: '', category: CATEGORIES[0], savedAt: Date.now() }; }

export function readDraft(storage: StorageLike, eventId: string, now = Date.now()): Draft {
  try {
    const raw = storage.getItem(key(eventId));
    if (!raw) return emptyDraft();
    const d = JSON.parse(raw) as Draft;
    if (!Number.isFinite(d.savedAt) || now - d.savedAt > DRAFT_TTL || d.savedAt > now ||
      typeof d.body !== 'string' || d.body.length > 500 || !CATEGORIES.includes(d.category)) throw new Error('invalid draft');
    if (d.pending && (d.pending.eventId !== eventId || d.pending.body !== d.body.trim() ||
      d.pending.category !== d.category || !['web', 'instagram'].includes(d.pending.source) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.pending.requestId))) throw new Error('invalid pending submission');
    return { ...d, retryAt: Number.isFinite(d.retryAt) ? d.retryAt : undefined };
  } catch {
    try { storage.removeItem(key(eventId)); } catch { /* Storage may be unavailable. */ }
    return emptyDraft();
  }
}

export function writeDraft(storage: StorageLike, eventId: string, draft: Draft): boolean {
  try {
    if (!draft.body && !draft.pending && !draft.retryAt) storage.removeItem(key(eventId));
    else storage.setItem(key(eventId), JSON.stringify(draft));
    return true;
  } catch { return false; }
}

/** A pending payload is immutable, including its source and requestId. */
export function prepareSubmission(draft: Draft, eventId: string, source: Submission['source'], createId: () => string): Submission {
  if (draft.pending) {
    if (draft.pending.eventId !== eventId || draft.pending.body !== draft.body.trim() || draft.pending.category !== draft.category) {
      throw new Error('送信結果を確認してから内容を変更してください。');
    }
    return draft.pending;
  }
  return { eventId, body: draft.body.trim(), category: draft.category, source, requestId: createId() };
}
