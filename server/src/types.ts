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

export const CATEGORY_ORDER: Record<Category, number> = {
  '大学生活': 0,
  '学び・授業': 1,
  '入試・進路': 2,
  '留学・国際交流': 3,
  'その他': 4,
};

export const EVENT_STATUSES = ['active', 'archived', 'deleted'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

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

export const EventLifecycleSchema = z.object({
  action: z.enum(['archive', 'unarchive', 'trash', 'restore']),
  version: z.number().int().min(1, 'versionを指定してください'),
});

export const FavoriteActionSchema = z.object({
  favorite: z.boolean(),
});

export const AdminReportQuerySchema = z.object({
  event: z.string().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  sort: z.enum(['newest', 'oldest', 'theme']).default('newest'),
  favorite: z.enum(['all', 'favorite', 'true', 'false']).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(ALLOWED_SOURCES).optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type PatchEventInput = z.infer<typeof PatchEventSchema>;
export type EventLifecycleInput = z.infer<typeof EventLifecycleSchema>;
export type FavoriteActionInput = z.infer<typeof FavoriteActionSchema>;
export type AdminReportQuery = z.infer<typeof AdminReportQuerySchema>;

// Firestore ドキュメント型定義
export interface QuestionDoc {
  eventId: string;
  body: string;
  category: Category;
  categoryOrder: number;
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
  status?: EventStatus;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string;
  schemaVersion: 1;
}

export interface UserFavoriteDoc {
  categoryOrder: number;
  sub: string;
  questionId: string;
  eventId: string;
  category: Category;
  dayJst: string;
  source: Source;
  sequence: number;
  active: boolean;
  updatedAt: Timestamp;
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
  /** 運営アカウント操作の対象 loginId（イベント操作では未設定） */
  targetId?: string;
  version: number;
  createdAt: Timestamp;
}

// 運営アカウント
export const OPERATOR_ROLES = ['owner', 'operator'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface OperatorDoc {
  loginId: string;
  displayName: string;
  passwordHash: string;
  role: OperatorRole;
  active: boolean;
  mustChange: boolean;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OperatorSessionDoc {
  operatorId: string;
  version: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export const LoginSchema = z.object({
  loginId: z.string().max(100),
  password: z.string().max(128),
});

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().max(128),
  newPassword: z.string(),
});

export const CreateOperatorSchema = z.object({
  loginId: z.string().max(100),
  displayName: z.string().trim().min(1, '表示名を入力してください').max(60, '表示名は60文字以内で入力してください'),
});

export const OPERATOR_ACTIONS = ['reset', 'disable', 'enable'] as const;
export type OperatorAction = (typeof OPERATOR_ACTIONS)[number];

// ログイン中の運営者（req.adminUser）。sub には loginId が入る。
export interface AdminIdentity {
  sub: string;
  loginId: string;
  displayName: string;
  role: OperatorRole;
  mustChange: boolean;
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
