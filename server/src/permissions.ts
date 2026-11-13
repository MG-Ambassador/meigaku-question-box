/**
 * 運営ロールと権限の一覧（サーバー側の正本）。
 * 画面側の lib/roles.ts も同じ内容に保つこと。
 *
 * | 操作                         | 開発者 | 責任者     | 教員 | アンバサダー | スタッフ |
 * | 質問の閲覧・集計・お気に入り | ◯      | ◯          | ◯    | ◯            | ◯        |
 * | 受付の開始・終了             | ◯      | ◯          | ◯    | ◯            | △ 受付の切り替えだけ |
 * | ルームの作成・編集           | ◯      | ◯          | ◯    | ◯            | －       |
 * | アーカイブ・ごみ箱・復元     | ◯      | ◯          | ◯    | ◯            | －       |
 * | ごみ箱を空にする             | ◯      | ◯          | －   | －           | －       |
 * | アカウント管理               | ◯ 全員 | ◯ 教員以下 | －   | －           | －       |
 * | 開発用ツール（本番）         | ◯      | －         | －   | －           | －       |
 */
export const OPERATOR_ROLES = ['developer', 'owner', 'faculty', 'ambassador', 'staff'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/** 旧ロール。保存済みのデータにだけ残っている（'operator' = 旧「担当者」）。 */
export type LegacyOperatorRole = 'operator';

export const ROLE_LABELS: Record<OperatorRole, string> = {
  developer: '開発者',
  owner: '責任者',
  faculty: '教員',
  ambassador: 'アンバサダー',
  staff: 'スタッフ',
};

export type Permission =
  | 'room.toggleOpen'
  | 'room.manage'
  | 'trash.empty'
  | 'accounts.manage';

const GRANTS: Record<OperatorRole, readonly Permission[]> = {
  developer: ['room.toggleOpen', 'room.manage', 'trash.empty', 'accounts.manage'],
  owner: ['room.toggleOpen', 'room.manage', 'trash.empty', 'accounts.manage'],
  faculty: ['room.toggleOpen', 'room.manage'],
  ambassador: ['room.toggleOpen', 'room.manage'],
  staff: ['room.toggleOpen'],
};

/** 保存済みのロールを現行のロールに読み替える。旧「担当者」はアンバサダー、不明な値は最も弱いスタッフ。 */
export function normalizeRole(role: unknown): OperatorRole {
  if (role === 'operator') return 'ambassador';
  return (OPERATOR_ROLES as readonly unknown[]).includes(role) ? (role as OperatorRole) : 'staff';
}

export function can(role: unknown, permission: Permission): boolean {
  return GRANTS[normalizeRole(role)].includes(permission);
}

/** そのロールの人が作成・再発行・利用停止できるアカウントのロール。 */
export function manageableRoles(role: unknown): OperatorRole[] {
  switch (normalizeRole(role)) {
    case 'developer':
      return [...OPERATOR_ROLES];
    case 'owner':
      return ['faculty', 'ambassador', 'staff'];
    default:
      return [];
  }
}
