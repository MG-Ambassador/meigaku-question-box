import { z } from 'zod';
import type { Timestamp } from '@google-cloud/firestore';

export const ALLOWED_CATEGORIES = [
  '大学生活',
  '学び・授業',
  '入試・進路',
  '留学・国際交流',
  'その他',
] as const;

export type Category = (typeof ALLOWED_CATEGORIES)[number];

export const ALLOWED_SOURCES = ['web', 'instagram'] as const;
export type Source = (typeof ALLOWED_SOURCES)[number];

// 質問投稿のリクエスト検証スキーマ
export const QuestionSubmissionSchema = z.object({
  eventId: z.string().min(1).max(100),
  body: z.string().trim().min(1, '質問を入力してください').max(500, '質問は500文字以内で入力してください'),
  category: z.enum(ALLOWED_CATEGORIES, {
    errorMap: () => ({ message: 'テーマを一覧から選択してください' }),
  }),
  source: z.enum(ALLOWED_SOURCES).default('web'),
  requestId: z.string().uuid('有効なrequestIdを指定してください'),
});

export type QuestionSubmission = z.infer<typeof QuestionSubmissionSchema>;

// イベント作成・更新のリクエスト検証スキーマ
export const CreateEventSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1, 'イベント名を入力してください').max(100, 'イベント名は100文字以内で入力してください'),
  date: z.string().trim().max(100).default(''),
  open: z.boolean().default(true),
  requestId: z.string().uuid().optional(),
});

export const PatchEventSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  date: z.string().trim().max(100).optional(),
  open: z.boolean().optional(),
  version: z.number().int().min(1, 'versionを指定してください'),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type PatchEventInput = z.infer<typeof PatchEventSchema>;

// Firestore ドキュメント型定義
export interface QuestionDoc {
  eventId: string;
  body: string;
  category: Category;
  source: Source;
  requestHash: string;
  createdAt: Timestamp;
  dayJst: string;
  sequence: number;
  schemaVersion: 1;
}

export interface EventDoc {
  title: string;
  date: string;
  open: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string;
  schemaVersion: 1;
}

export interface EventStatsDoc {
  total: number;
  lastSequence: number;
  categories: Record<string, number>;
  sources: Record<string, number>;
  recentDays: Record<string, number>;
  updatedAt: Timestamp;
  dataVersion: number;
  schemaVersion: 1;
}

export interface RateLimitDoc {
  acceptedAt: Timestamp[];
  expiresAt: Timestamp;
}

export interface AuditDoc {
  actorSub: string;
  action: string;
  eventId: string;
  version: number;
  createdAt: Timestamp;
}

// 管理者識別情報
export interface AdminIdentity {
  sub: string;
  displayName: string;
  email?: string;
}

// API エラー型
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    traceId?: string;
    retryAfterSeconds?: number;
  };
}
