'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ApiError,
  changeAdminEventLifecycle,
  getPublicEvent,
  saveAdminEvent,
  updateAdminEvent,
  type EventItem,
} from '@/lib/api-client';
import { Switch } from '@/components/ui/switch';
import { ActionButton } from './action-button';
import { ConfirmDialog } from './confirm-dialog';
import { ShareControls } from './share-controls';

export function EventSettings({
  event,
  token,
  onSaved,
  onAuthError,
  onDirtyChange,
  onBusyChange,
  saveRef,
  discardRef,
}: {
  event?: EventItem;
  token: string;
  onSaved: (event: EventItem) => void;
  onAuthError: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  saveRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  discardRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [baseline, setBaseline] = useState(event);
  const [title, setTitle] = useState(event?.title || '');
  const [date, setDate] = useState(event?.date || '');
  const [accepting, setAccepting] = useState(event ? !!event.open : true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const titleErrorId = useId();
  const creationId = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<EventItem | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmLifecycle, setConfirmLifecycle] = useState<'archive' | 'trash' | 'restore' | null>(null);

  const isDeleted = baseline?.status === 'deleted';
  const isArchived = baseline?.status === 'archived';

  const hasUnsavedChanges = baseline
    ? (title !== baseline.title || date !== (baseline.date || '') || accepting !== !!baseline.open)
    : !!(title.trim() || date.trim() || !accepting);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  useEffect(() => {
    if (!hasUnsavedChanges && !busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges, busy]);

  function discard() {
    if (baseline) {
      setTitle(baseline.title);
      setDate(baseline.date || '');
      setAccepting(!!baseline.open);
      setError('');
      setMessage('');
      setConflict(null);
    } else {
      setTitle('');
      setDate('');
      setAccepting(true);
      setError('');
      setMessage('');
    }
  }

  useEffect(() => {
    if (discardRef) {
      discardRef.current = discard;
      return () => {
        discardRef.current = null;
      };
    }
  });

  const pendingSaveResolve = useRef<((value: boolean) => void) | null>(null);

  async function save(): Promise<boolean> {
    if (lock.current || conflict || isDeleted) return false;
    if (!title.trim()) {
      setError('ルーム名を入力してください。');
      titleInput.current?.focus();
      return false;
    }
    lock.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let saved: EventItem;
      if (baseline) {
        if (!baseline.version) throw new Error('最新のルーム情報を取得してから保存してください。');
        saved = await updateAdminEvent(token, baseline.id, {
          title,
          date,
          open: accepting,
          version: baseline.version,
        });
      } else {
        creationId.current ||= crypto.randomUUID();
        const result = await saveAdminEvent(token, {
          id: creationId.current,
          title,
          date,
          open: accepting,
        });
        saved = await getPublicEvent(result.id);
      }
      setBaseline(saved);
      setTitle(saved.title);
      setDate(saved.date);
      setAccepting(!!saved.open);
      setMessage('ルームを保存しました。');
      onSaved(saved);
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 401 || e.statusCode === 403)) {
        onAuthError();
        return false;
      }
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT' && baseline) {
        setError('別の担当者が変更しました。入力内容は残しています。最新情報と比較してください。');
        try {
          setConflict(await getPublicEvent(baseline.id));
        } catch {
          setError('最新情報を取得できませんでした。入力を残しています。再度保存すると確認できます。');
        }
      } else {
        setError(e instanceof Error ? e.message : '保存できませんでした。入力内容は残しています。');
      }
      return false;
    } finally {
      lock.current = false;
      onBusyChange?.(false);
      setBusy(false);
    }
  }

  const stopConfirmed = useRef(false);

  async function requestSave(): Promise<boolean> {
    if (lock.current || conflict || isDeleted) return false;
    if (!title.trim()) {
      setError('ルーム名を入力してください。');
      titleInput.current?.focus();
      return false;
    }
    if (baseline?.open && !accepting) {
      stopConfirmed.current = false;
      return new Promise<boolean>((resolve) => {
        pendingSaveResolve.current = resolve;
        setConfirmStop(true);
      });
    }
    return await save();
  }

  async function handleConfirmStop() {
    stopConfirmed.current = true;
    setConfirmStop(false);
    const ok = await save();
    pendingSaveResolve.current?.(ok);
    pendingSaveResolve.current = null;
  }

  function handleCancelStop() {
    if (stopConfirmed.current) return;
    setConfirmStop(false);
    pendingSaveResolve.current?.(false);
    pendingSaveResolve.current = null;
  }

  useEffect(() => {
    if (saveRef) {
      saveRef.current = requestSave;
      return () => {
        saveRef.current = null;
      };
    }
  });

  async function executeLifecycle(action: 'archive' | 'trash' | 'restore') {
    if (!baseline || lock.current) return;
    lock.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await changeAdminEventLifecycle(
        token,
        baseline.id,
        action,
        baseline.version || 1
      );
      setBaseline(updated);
      setAccepting(!!updated.open);
      onSaved(updated);
      setMessage(
        action === 'archive'
          ? 'ルームをアーカイブしました。'
          : action === 'trash'
          ? 'ルームをごみ箱へ移動しました。'
          : baseline.status === 'deleted'
          ? 'ルームを復元しました（アーカイブ状態）。'
          : 'アーカイブを解除して通常ルームに戻しました。'
      );
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 401 || e.statusCode === 403)) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : '状態の変更に失敗しました。');
    } finally {
      lock.current = false;
      onBusyChange?.(false);
      setBusy(false);
      setConfirmLifecycle(null);
    }
  }

  const switchId = useId();

  return (
    <div className="settings-stack">
      <form
        className="settings-form surface"
        onSubmit={(e) => {
          e.preventDefault();
          void requestSave();
        }}
      >
        <div className="section-heading">
          <h2>{baseline ? 'ルームの設定' : '新しいルーム'}</h2>
          <p className="muted">来場者に表示する情報を設定します。</p>
        </div>

        {isDeleted && (
          <div className="notice notice-error" role="alert">
            <p>このルームはごみ箱にあります。編集や質問募集を行うには、アーカイブとして復元してください。</p>
          </div>
        )}

        <label className="field-label">
          ルーム名
          <input
            ref={titleInput}
            aria-invalid={!!error && !title.trim() || undefined}
            aria-describedby={error && !title.trim() ? titleErrorId : undefined}
            className="field-input"
            required
            maxLength={100}
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (!title.trim()) setError(''); }}
            disabled={busy || isDeleted}
            placeholder="オープンキャンパス"
          />
        </label>
        <label className="field-label">
          開催日時・会場 <span className="muted">任意</span>
          <input
            className="field-input"
            maxLength={100}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy || isDeleted}
            placeholder="10月10日 13:00〜 白金キャンパス"
          />
        </label>
        <label className="accepting-control" htmlFor={switchId}>
          <span>
            <strong>質問を受け付ける</strong>
            <small>
              {accepting ? '募集ページから質問を送れます' : '募集ページに受付終了と表示します'}
              （{baseline ? `公開中：${baseline.open ? '受付中' : '受付終了'}` : '未作成'} · 変更は保存すると反映されます）
            </small>
          </span>
          <Switch
            id={switchId}
            className="accepting-switch"
            checked={accepting}
            onCheckedChange={setAccepting}
            disabled={busy || isDeleted}
          />
        </label>

        {error && (
          <p id={titleErrorId} className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <div className="conflict-box">
            <h3>現在保存されている内容</h3>
            <dl>
              <dt>ルーム名</dt>
              <dd>{conflict.title}</dd>
              <dt>開催日時・会場</dt>
              <dd>{conflict.date || '未設定'}</dd>
              <dt>受付</dt>
              <dd>{conflict.open ? '受付中' : '受付終了'}</dd>
            </dl>
            <p>上の入力欄があなたの編集内容です。最新の内容を確認してから保存してください。</p>
            <div className="button-row">
              <ActionButton
                type="button"
                tone="secondary"
                onClick={() => {
                  setBaseline(conflict);
                  setConflict(null);
                  setError('');
                  setMessage('最新情報を確認しました。入力内容を保存できます。');
                }}
              >
                確認して編集を続ける
              </ActionButton>
              <ActionButton
                type="button"
                tone="quiet"
                onClick={() => {
                  setBaseline(conflict);
                  setTitle(conflict.title);
                  setDate(conflict.date);
                  setAccepting(!!conflict.open);
                  setConflict(null);
                  setError('');
                }}
              >
                最新の内容を採用
              </ActionButton>
            </div>
          </div>
        )}
        {!isDeleted && (
          <div className="button-row" style={{ alignItems: 'center', gap: '12px' }}>
            <ActionButton
              type="submit"
              busy={busy}
              disabled={!hasUnsavedChanges || !title.trim() || !!conflict}
            >
              {busy ? '保存中…' : 'ルームを保存'}
            </ActionButton>
            {hasUnsavedChanges && (
              <span className="unsaved-badge" role="status">
                未保存の変更があります
              </span>
            )}
          </div>
        )}
        <p role="status" className="muted">
          {message}
        </p>
      </form>

      {baseline && !isDeleted && (
        <section className="surface">
          <div className="section-heading">
            <h2>質問を募集する</h2>
            <p className="muted">会場やSNSで、このルームの質問箱を案内できます。</p>
          </div>
          <ShareControls key={baseline.id} operator eventId={baseline.id} title={baseline.title} />
        </section>
      )}

      {baseline && (
        <section className="surface room-lifecycle-card">
          <div className="section-heading">
            <h2>ルームの整理</h2>
            <p className="muted">
              {isDeleted
                ? 'ごみ箱にあるルームです。質問データは保持されています。'
                : isArchived
                ? 'アーカイブされたルームです。質問データ・集計は保持されています。'
                : 'ルームの終了や整理を行います。質問データは削除されません。'}
            </p>
          </div>
          <div className="button-row">
            {isDeleted ? (
              <ActionButton
                type="button"
                tone="secondary"
                busy={busy}
                onClick={() => setConfirmLifecycle('restore')}
              >
                アーカイブとして復元
              </ActionButton>
            ) : isArchived ? (
              <>
                <ActionButton
                  type="button"
                  tone="secondary"
                  busy={busy}
                  onClick={() => setConfirmLifecycle('restore')}
                >
                  アーカイブを解除して通常に戻す
                </ActionButton>
                <ActionButton
                  type="button"
                  tone="quiet"
                  busy={busy}
                  onClick={() => setConfirmLifecycle('trash')}
                >
                  ごみ箱へ移動
                </ActionButton>
              </>
            ) : (
              <>
                <ActionButton
                  type="button"
                  tone="secondary"
                  busy={busy}
                  onClick={() => setConfirmLifecycle('archive')}
                >
                  ルームをアーカイブ
                </ActionButton>
                <ActionButton
                  type="button"
                  tone="quiet"
                  busy={busy}
                  onClick={() => setConfirmLifecycle('trash')}
                >
                  ごみ箱へ移動
                </ActionButton>
              </>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={(open) => {
          if (!open) handleCancelStop();
        }}
        title="質問の受付を終了しますか？"
        description={`「${baseline?.title || title}」への新しい質問を停止します。保存済みの質問は引き続き閲覧できます。`}
        action="受付を終了して保存"
        cancelText="キャンセル"
        onConfirm={() => void handleConfirmStop()}
      />

      <ConfirmDialog
        open={confirmLifecycle === 'archive'}
        onOpenChange={(open) => !open && setConfirmLifecycle(null)}
        title="ルームをアーカイブしますか？"
        description={`「${baseline?.title || title}」をアーカイブに移動します。質問の受付は自動的に終了し、通常のルーム一覧には表示されなくなります。過去の質問データやお気に入りはすべて保持されます。`}
        action="アーカイブする"
        onConfirm={() => void executeLifecycle('archive')}
      />

      <ConfirmDialog
        open={confirmLifecycle === 'trash'}
        onOpenChange={(open) => !open && setConfirmLifecycle(null)}
        title="ルームをごみ箱へ移動しますか？"
        description={`「${baseline?.title || title}」をごみ箱へ移動します。来場者からはアクセスできなくなります。データはごみ箱に保持され、いつでも復元できます。`}
        action="ごみ箱へ移動"
        onConfirm={() => void executeLifecycle('trash')}
      />

      <ConfirmDialog
        open={confirmLifecycle === 'restore'}
        onOpenChange={(open) => !open && setConfirmLifecycle(null)}
        title={isDeleted ? 'ルームを復元しますか？' : 'アーカイブを解除しますか？'}
        description={
          isDeleted
            ? `「${baseline?.title || title}」をごみ箱からアーカイブ一覧へ復元します。復元直後は安全のため受付は終了のままとなります。`
            : `「${baseline?.title || title}」を通常のルーム一覧へ戻します。受付状態は安全のため終了のままとなりますので、必要に応じて受付を再開してください。`
        }
        action={isDeleted ? 'アーカイブとして復元' : '通常ルームに戻す'}
        onConfirm={() => void executeLifecycle('restore')}
      />
    </div>
  );
}
