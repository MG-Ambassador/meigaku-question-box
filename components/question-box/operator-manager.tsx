'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, UserPlus } from 'lucide-react';
import {
  ApiError,
  changeOperatorRole,
  createOperator,
  listOperators,
  operatorAction,
  type OperatorItem,
  type OperatorRole,
} from '@/lib/api-client';
import { manageableRoles, normalizeRole, ROLE_LABELS } from '@/lib/roles';
import { ActionButton } from './action-button';
import { ConfirmDialog } from './confirm-dialog';

type PendingAction = { operator: OperatorItem; action: 'reset' | 'disable' | 'enable' };
type PendingRole = { operator: OperatorItem; role: OperatorRole };
type Issued = { loginId: string; temporaryPassword: string; reason: 'create' | 'reset' };

const ACTION_TEXT = {
  reset: {
    title: '仮パスワードを再発行しますか？',
    body: 'このアカウントの現在のパスワードとログイン中の端末はすべて無効になります。新しい仮パスワードは一度だけ表示されます。',
    action: '再発行する',
  },
  disable: {
    title: '利用を停止しますか？',
    body: 'このアカウントはすぐにログアウトされ、再開するまでログインできなくなります。',
    action: '利用を停止する',
  },
  enable: {
    title: '利用を再開しますか？',
    body: 'このアカウントは現在のパスワードで再びログインできるようになります。',
    action: '利用を再開する',
  },
} as const;

/** 開発者・責任者向け：アカウントの一覧・追加・ロール変更・仮パスワード再発行・利用停止/再開 */
export function OperatorManager({
  token,
  currentLoginId,
  currentRole,
  onAuthError,
}: {
  token: string;
  currentLoginId?: string;
  currentRole?: OperatorRole;
  onAuthError: () => void;
}) {
  const allowedRoles = manageableRoles(currentRole);
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loginId, setLoginId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<OperatorRole>('ambassador');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingRole, setPendingRole] = useState<PendingRole | null>(null);
  const [acting, setActing] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.statusCode === 401) {
        onAuthError();
        return;
      }
      setError(err instanceof ApiError ? err.message : fallback);
    },
    [onAuthError]
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const items = await listOperators(token, signal);
        if (!signal?.aborted) setOperators(items);
      } catch (err) {
        if (!signal?.aborted) handleError(err, 'アカウントを読み込めませんでした。');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token, handleError]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the operator list from the API when the sheet opens.
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function create() {
    if (creating) return;
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(loginId.trim())) {
      setError('運営IDは半角英数字・ハイフン・アンダーバーの3〜40文字で入力してください。');
      return;
    }
    if (!displayName.trim()) {
      setError('表示名を入力してください。');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await createOperator(token, { loginId: loginId.trim(), displayName: displayName.trim(), role });
      setIssued({ loginId: result.loginId, temporaryPassword: result.temporaryPassword, reason: 'create' });
      setCopied(false);
      setLoginId('');
      setDisplayName('');
      await load();
    } catch (err) {
      handleError(err, 'アカウントを追加できませんでした。');
    } finally {
      setCreating(false);
    }
  }

  async function runAction() {
    if (!pending || acting) return;
    setActing(true);
    setError('');
    try {
      const result = await operatorAction(token, pending.operator.loginId, pending.action);
      if (result.temporaryPassword) {
        setIssued({ loginId: result.loginId, temporaryPassword: result.temporaryPassword, reason: 'reset' });
        setCopied(false);
      }
      await load();
    } catch (err) {
      handleError(err, 'アカウントを更新できませんでした。');
    } finally {
      setActing(false);
      setPending(null);
    }
  }

  async function runRoleChange() {
    if (!pendingRole || acting) return;
    setActing(true);
    setError('');
    try {
      await changeOperatorRole(token, pendingRole.operator.loginId, pendingRole.role);
      await load();
    } catch (err) {
      handleError(err, 'ロールを変更できませんでした。');
    } finally {
      setActing(false);
      setPendingRole(null);
    }
  }

  async function copyIssued() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="settings-stack operator-manager">
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {issued && (
        <div className="notice" role="status">
          <p className="font-semibold">
            {issued.reason === 'create' ? 'アカウントを追加しました。' : '仮パスワードを再発行しました。'}
          </p>
          <p className="mt-1">
            運営ID <strong>{issued.loginId}</strong> の仮パスワードです。この画面を閉じると再表示できません。本人に直接伝えてください。
          </p>
          <p className="temporary-password" aria-label="仮パスワード">
            <code>{issued.temporaryPassword}</code>
          </p>
          <ActionButton tone="secondary" onClick={() => void copyIssued()}>
            <Copy size={16} />
            {copied ? 'コピーしました' : '仮パスワードをコピー'}
          </ActionButton>
          <ActionButton tone="quiet" onClick={() => setIssued(null)}>
            表示を閉じる
          </ActionButton>
        </div>
      )}

      <section aria-label="アカウント一覧">
        <h3 className="operator-heading">アカウント一覧</h3>
        {loading && <p className="muted" role="status">読み込み中…</p>}
        {!loading && operators.length === 0 && <p className="muted">アカウントはまだありません。</p>}
        <ul className="operator-list">
          {operators.map((item) => {
            const self = item.loginId === currentLoginId;
            const manageable = allowedRoles.includes(normalizeRole(item.role)) && !self;
            return (
              <li key={item.loginId} className="operator-row">
                <div>
                  <strong>{item.displayName}</strong>
                  <span className="muted operator-meta">
                    {item.loginId}
                    {`・${ROLE_LABELS[normalizeRole(item.role)]}`}
                    {self ? '・自分' : ''}
                    {!item.active ? '・利用停止中' : item.mustChange ? '・初回変更待ち' : ''}
                  </span>
                </div>
                {manageable && (
                  <div className="operator-actions">
                    <select
                      className="field-input operator-role-select"
                      aria-label={`${item.displayName}のロール`}
                      value={normalizeRole(item.role)}
                      disabled={acting}
                      onChange={(e) => setPendingRole({ operator: item, role: e.target.value as OperatorRole })}
                    >
                      {allowedRoles.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <ActionButton tone="quiet" disabled={acting} onClick={() => setPending({ operator: item, action: 'reset' })}>
                      <KeyRound size={16} />
                      再発行
                    </ActionButton>
                    <ActionButton
                      tone={item.active ? 'danger' : 'secondary'}
                      disabled={acting}
                      onClick={() => setPending({ operator: item, action: item.active ? 'disable' : 'enable' })}
                    >
                      {item.active ? '停止' : '再開'}
                    </ActionButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <form
        className="settings-form"
        aria-label="アカウントを追加"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3 className="operator-heading">アカウントを追加</h3>
        <label className="field-label">
          運営ID <span className="muted">半角英数字・-・_ の3〜40文字</span>
          <input
            className="field-input"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={40}
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            disabled={creating}
          />
        </label>
        <label className="field-label">
          ロール
          <select
            className="field-input"
            value={role}
            onChange={(e) => setRole(e.target.value as OperatorRole)}
            disabled={creating}
          >
            {allowedRoles.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          表示名
          <input
            className="field-input"
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={creating}
          />
        </label>
        <ActionButton type="submit" tone="secondary" busy={creating}>
          <UserPlus size={18} />
          追加して仮パスワードを発行
        </ActionButton>
      </form>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !acting) setPending(null);
        }}
        title={pending ? ACTION_TEXT[pending.action].title : ''}
        description={pending ? `${pending.operator.displayName}（${pending.operator.loginId}）: ${ACTION_TEXT[pending.action].body}` : ''}
        action={pending ? ACTION_TEXT[pending.action].action : ''}
        actionTone={pending?.action === 'disable' ? 'danger' : 'primary'}
        onConfirm={() => void runAction()}
      />

      <ConfirmDialog
        open={!!pendingRole}
        onOpenChange={(open) => {
          if (!open && !acting) setPendingRole(null);
        }}
        title="ロールを変更しますか？"
        description={
          pendingRole
            ? `${pendingRole.operator.displayName}（${pendingRole.operator.loginId}）を「${ROLE_LABELS[normalizeRole(pendingRole.operator.role)]}」から「${ROLE_LABELS[pendingRole.role]}」に変更します。このアカウントはログアウトされ、次のログインから新しい権限になります。`
            : ''
        }
        action="変更する"
        actionTone="primary"
        onConfirm={() => void runRoleChange()}
      />
    </div>
  );
}
