'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, UserPlus } from 'lucide-react';
import {
  ApiError,
  createOperator,
  listOperators,
  operatorAction,
  type OperatorItem,
} from '@/lib/api-client';
import { ActionButton } from './action-button';
import { ConfirmDialog } from './confirm-dialog';

type PendingAction = { operator: OperatorItem; action: 'reset' | 'disable' | 'enable' };
type Issued = { loginId: string; temporaryPassword: string; reason: 'create' | 'reset' };

const ACTION_TEXT = {
  reset: {
    title: '仮パスワードを再発行しますか？',
    body: 'この担当者の現在のパスワードとログイン中の端末はすべて無効になります。新しい仮パスワードは一度だけ表示されます。',
    action: '再発行する',
  },
  disable: {
    title: '利用を停止しますか？',
    body: 'この担当者はすぐにログアウトされ、再開するまでログインできなくなります。',
    action: '利用を停止する',
  },
  enable: {
    title: '利用を再開しますか？',
    body: 'この担当者は現在のパスワードで再びログインできるようになります。',
    action: '利用を再開する',
  },
} as const;

/** 運営責任者向け：担当者の一覧・追加・仮パスワード再発行・利用停止/再開 */
export function OperatorManager({
  token,
  currentLoginId,
  onAuthError,
}: {
  token: string;
  currentLoginId?: string;
  onAuthError: () => void;
}) {
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loginId, setLoginId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
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
        if (!signal?.aborted) handleError(err, '担当者を読み込めませんでした。');
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
      const result = await createOperator(token, { loginId: loginId.trim(), displayName: displayName.trim() });
      setIssued({ loginId: result.loginId, temporaryPassword: result.temporaryPassword, reason: 'create' });
      setCopied(false);
      setLoginId('');
      setDisplayName('');
      await load();
    } catch (err) {
      handleError(err, '担当者を追加できませんでした。');
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
      handleError(err, '担当者を更新できませんでした。');
    } finally {
      setActing(false);
      setPending(null);
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
            {issued.reason === 'create' ? '担当者を追加しました。' : '仮パスワードを再発行しました。'}
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

      <section aria-label="担当者一覧">
        <h3 className="operator-heading">担当者一覧</h3>
        {loading && <p className="muted" role="status">読み込み中…</p>}
        {!loading && operators.length === 0 && <p className="muted">担当者はまだいません。</p>}
        <ul className="operator-list">
          {operators.map((item) => {
            const self = item.loginId === currentLoginId;
            const manageable = item.role === 'operator' && !self;
            return (
              <li key={item.loginId} className="operator-row">
                <div>
                  <strong>{item.displayName}</strong>
                  <span className="muted operator-meta">
                    {item.loginId}
                    {item.role === 'owner' ? '・運営責任者' : ''}
                    {self ? '・自分' : ''}
                    {!item.active ? '・利用停止中' : item.mustChange ? '・初回変更待ち' : ''}
                  </span>
                </div>
                {manageable && (
                  <div className="operator-actions">
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
        aria-label="担当者を追加"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3 className="operator-heading">担当者を追加</h3>
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
    </div>
  );
}
