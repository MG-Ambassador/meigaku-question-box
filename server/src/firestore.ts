import { Firestore, Timestamp } from '@google-cloud/firestore';

export const COLLECTION_QUESTIONS = 'questions';
export const COLLECTION_EVENTS = 'events';
export const COLLECTION_EVENT_STATS = 'eventStats';
export const COLLECTION_RATE_LIMITS = 'rateLimits';
export const COLLECTION_AUDIT = 'audit';
export const COLLECTION_ADMIN_REQUESTS = 'adminRequests';

let firestoreInstance: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!firestoreInstance) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const databaseId = process.env.FIRESTORE_DATABASE_ID;

    firestoreInstance = new Firestore({
      projectId: projectId || undefined,
      databaseId: databaseId || '(default)',
      ignoreUndefinedProperties: true,
    });
  }
  return firestoreInstance;
}

export function setFirestore(instance: Firestore | null): void {
  firestoreInstance = instance;
}

/**
 * 日本時間 (Asia/Tokyo) の YYYY-MM-DD 文字列を生成する
 */
export function formatDayJst(date: Date): string {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export { Timestamp };
