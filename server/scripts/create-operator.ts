/**
 * 運営アカウントの作成・パスワード再発行（保守用 CLI）
 *
 * 最初の運営責任者（owner）の作成と、運営責任者がパスワードを忘れたときの復旧に使う。
 * 通常の担当者の追加・再発行・停止は管理画面の「担当者管理」から行う。
 *
 * 使い方（qa_box/ から）:
 *   npm run operator:create -- --login-id <ID> --display-name <表示名> [--role owner|operator]            # 確認のみ
 *   npm run operator:create -- --login-id <ID> --display-name <表示名> [--role owner|operator] --execute  # 作成
 *   npm run operator:create -- --login-id <ID> --reset --execute                                          # 仮パスワード再発行
 *
 * 接続先は server/.env の GOOGLE_CLOUD_PROJECT / FIRESTORE_DATABASE_ID（または FIRESTORE_EMULATOR_HOST）。
 * 仮パスワードは標準出力に一度だけ表示し、ファイルには保存しない。初回ログイン時に本人が変更する。
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { getFirestore, COLLECTION_OPERATORS, COLLECTION_AUDIT, Timestamp } from '../src/firestore.js';
import { generateTemporaryPassword, hashPassword, normalizeLoginId } from '../src/password.js';
import { revokeAllSessions } from '../src/sessions.js';
import { OPERATOR_ROLES, type OperatorDoc, type OperatorRole, type AuditDoc } from '../src/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

const loginId = normalizeLoginId(arg('--login-id'));
const displayName = (arg('--display-name') || '').trim();
const role = (arg('--role') || 'owner') as OperatorRole;
const reset = process.argv.includes('--reset');
const execute = process.argv.includes('--execute');

if (!loginId) fail('--login-id には半角英数字・ハイフン・アンダーバーの3〜40文字を指定してください。');
if (!reset && (!displayName || displayName.length > 60)) fail('--display-name に60文字以内の表示名を指定してください。');
if (!OPERATOR_ROLES.includes(role)) fail('--role には owner または operator を指定してください。');

const target = process.env.FIRESTORE_EMULATOR_HOST
  ? `エミュレータ ${process.env.FIRESTORE_EMULATOR_HOST}`
  : `プロジェクト ${process.env.GOOGLE_CLOUD_PROJECT || '(ADC の既定)'} / DB ${process.env.FIRESTORE_DATABASE_ID || '(default)'}`;
console.log(`[接続先] ${target}`);
console.log(`[操作] ${reset ? '仮パスワード再発行' : `作成 (role=${role}, 表示名=${displayName})`} 運営ID=${loginId}`);

const db = getFirestore();
const ref = db.collection(COLLECTION_OPERATORS).doc(loginId);
const existing = await ref.get();

if (reset && !existing.exists) fail('指定した運営IDは存在しません。');
if (!reset && existing.exists) fail('指定した運営IDは既に存在します。復旧する場合は --reset を指定してください。');

if (!execute) {
  console.log('[DRY-RUN] 書き込みは行っていません。実行するには --execute を付けてください。');
  process.exit(0);
}

const temporaryPassword = generateTemporaryPassword();
const passwordHash = await hashPassword(temporaryPassword);
const now = Timestamp.now();

const version = await db.runTransaction(async (transaction) => {
  const snap = await transaction.get(ref);
  let nextVersion = 1;
  if (reset) {
    if (!snap.exists) throw new Error('指定した運営IDは存在しません。');
    const current = snap.data() as OperatorDoc;
    nextVersion = current.version + 1;
    transaction.update(ref, { passwordHash, mustChange: true, active: true, version: nextVersion, updatedAt: now });
  } else {
    if (snap.exists) throw new Error('指定した運営IDは既に存在します。');
    const doc: OperatorDoc = {
      loginId,
      displayName,
      passwordHash,
      role,
      active: true,
      mustChange: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    transaction.set(ref, doc);
  }
  const log: AuditDoc = {
    actorSub: 'maintenance-cli',
    action: reset ? 'operator_reset' : 'operator_create',
    eventId: '',
    targetId: loginId,
    version: nextVersion,
    createdAt: now,
  };
  transaction.set(db.collection(COLLECTION_AUDIT).doc(crypto.randomUUID()), log);
  return nextVersion;
});

if (reset) await revokeAllSessions(loginId);

console.log('');
console.log(`運営ID:         ${loginId}`);
console.log(`仮パスワード:   ${temporaryPassword}`);
console.log(`(version ${version}) この仮パスワードは再表示できません。本人に直接渡し、初回ログイン時に変更してもらってください。`);
process.exit(0);
