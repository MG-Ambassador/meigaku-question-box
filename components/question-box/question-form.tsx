'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  LockKeyhole,
  Send,
} from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiError, submitQuestion, type EventItem } from '@/lib/api-client';
import {
  CATEGORIES,
  emptyDraft,
  prepareSubmission,
  readDraft,
  writeDraft,
  type Category,
  type Draft,
} from '@/lib/question-draft';
import { ActionButton } from './action-button';
import { ShareControls } from './share-controls';
import { ConfirmDialog } from './confirm-dialog';

export function QuestionForm({
  event,
  onBusyChange,
  onClosed,
}: {
  event: EventItem;
  onBusyChange: (busy: boolean) => void;
  onClosed: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = useRef(draft);
  const sending = useRef(false);
  const mounted = useRef(true);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [isFlying, setIsFlying] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [complete, setComplete] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [isCheckingPending, setIsCheckingPending] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const completeHeading = useRef<HTMLHeadingElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);

  function persist(next: Draft) {
    const saved = { ...next, savedAt: Date.now() };
    current.current = saved;
    setDraft(saved);
    try {
      setStorageUnavailable(!writeDraft(window.sessionStorage, event.id, saved));
    } catch {
      setStorageUnavailable(true);
    }
  }

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = readDraft(window.sessionStorage, event.id);
      current.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the event-specific draft from browser sessionStorage after hydration.
      setDraft(saved);
    } catch {
      setStorageUnavailable(true);
    }
    setReady(true);
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [event.id]);

  useEffect(() => {
    if (!busy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear the external request timer indication when the request finishes.
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    const update = () =>
      setRemaining(Math.max(0, Math.ceil(((draft.retryAt || 0) - Date.now()) / 1000)));
    update();
    if (!draft.retryAt) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [draft.retryAt]);

  useEffect(() => {
    if (complete) {
      completeHeading.current?.focus();
    }
  }, [complete]);

  async function handleSend() {
    if (
      sending.current ||
      !ready ||
      offline ||
      remaining > 0 ||
      (!event.open && !current.current.pending)
    ) {
      return;
    }

    const bodyTrimmed = current.current.body.trim();
    if (!bodyTrimmed) {
      setError('質問を入力してください。');
      bodyInput.current?.focus();
      return;
    }

    sending.current = true;
    setIsCheckingPending(!!current.current.pending);
    setBusy(true);
    onBusyChange(true);
    setError('');

    // Trigger visual flight takeoff (~240ms) without delaying communication
    setIsFlying(!current.current.pending);
    const takeoffTimer = setTimeout(() => {
      if (mounted.current) setIsFlying(false);
    }, 260);

    try {
      const source =
        new URLSearchParams(window.location.search).get('from') === 'instagram'
          ? 'instagram'
          : 'web';
      const pending = prepareSubmission(
        current.current,
        event.id,
        source,
        () => crypto.randomUUID()
      );
      persist({ ...current.current, pending });

      const result = await submitQuestion(pending);
      if (!result.ok || !result.id) throw new Error('受付が完了したか確認できませんでした。');

      if (mounted.current) {
        persist(emptyDraft());
        setComplete(true);
      } else {
        try {
          const saved = readDraft(window.sessionStorage, event.id);
          if (saved.pending?.requestId === pending.requestId) {
            writeDraft(window.sessionStorage, event.id, emptyDraft());
          }
        } catch {
          /* Storage may be unavailable */
        }
      }
    } catch (e) {
      if (!mounted.current) return;
      setIsFlying(false);

      if (e instanceof ApiError && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 408) {
        const next = { ...current.current, pending: undefined };
        if (e.statusCode === 429) {
          next.retryAt = Date.now() + Math.max(1, e.retryAfterSeconds || 600) * 1000;
          setError('続けて投稿されています。表示の時間をおいて、もう一度お試しください。');
        } else if (e.code === 'EVENT_CLOSED' || e.code === 'EVENT_NOT_FOUND') {
          onClosed();
          setError('このルームは質問を受け付けていません。入力内容は残しています。');
        } else {
          setError(e.message);
        }
        persist(next);
      } else {
        setError(
          '受付が完了したか確認できませんでした。同じ内容で確認できます。'
        );
      }
    } finally {
      clearTimeout(takeoffTimer);
      sending.current = false;
      if (mounted.current) {
        setBusy(false);
        setIsCheckingPending(false);
        onBusyChange(false);
      }
    }
  }

  if (complete) {
    return (
      <section className="completion in-page-completion" aria-labelledby="complete-title">
        <span className="completion-check">
          <Check size={38} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <h1 id="complete-title" tabIndex={-1} ref={completeHeading}>
          質問を受け付けました
        </h1>
        <p>
          運営が確認し、イベントで
          <br className="mobile-break" />
          紹介する場合があります。
        </p>
        <div className="completion-actions">
          <ActionButton
            type="button"
            className="full-width"
            tone="primary"
            onClick={() => {
              setComplete(false);
              setError('');
              requestAnimationFrame(() => bodyInput.current?.focus());
            }}
          >
            もう1件質問する <ArrowRight size={19} aria-hidden="true" />
          </ActionButton>
        </div>
        <div className="completion-share">
          <ShareControls eventId={event.id} title={event.title} />
        </div>
      </section>
    );
  }

  return (
    <div className="question-container">
      <form
        className="question-form paper-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        aria-busy={!ready || busy}
      >
        {!event.open && (
          <p className="notice" role="status">
            このルームは受付を終了しました。
            {draft.pending
              ? '前回の送信結果は確認できます。'
              : '入力した内容は残しています。'}
          </p>
        )}

        {draft.pending && !busy && (
          <div className="notice" role="status">
            <p>
              前回の送信結果が未確認です。下の「送信結果を確認」から重複せずに受け取れます。
            </p>
            <div className="button-row" style={{ marginTop: '8px' }}>
              <ActionButton
                type="button"
                tone="quiet"
                onClick={() => setEditPending(true)}
              >
                内容を変更する
              </ActionButton>
            </div>
          </div>
        )}

        <div className="question-heading">
          <span className="question-number" aria-hidden="true">
            Q.
          </span>
          <h1>
            <label htmlFor="question-body">聞いてみたいこと</label>
          </h1>
        </div>

        <textarea
          id="question-body"
          ref={bodyInput}
          className="question-input"
          placeholder="例えば、入学前にやっておいてよかったことは？"
          value={draft.body}
          maxLength={500}
          readOnly={!!draft.pending}
          disabled={!ready || busy}
          aria-describedby="question-note question-count question-error"
          aria-invalid={!!error || undefined}
          onChange={(e) => {
            if (draft.pending) return;
            persist({ ...current.current, body: e.target.value });
            setError('');
          }}
          onKeyDown={(e) => {
            // Keep Enter key as newline inside textarea; do not submit on Enter or IME
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.stopPropagation();
            }
          }}
        />

        <div className="input-meta">
          <p id="question-note">氏名や連絡先は書かないでください。</p>
          <span id="question-count">{draft.body.length} / 500</span>
        </div>

        <fieldset
          disabled={!ready || busy || !!draft.pending}
          className="theme-field"
        >
          <legend>テーマ</legend>
          <RadioGroup
            value={draft.category}
            onValueChange={(category) =>
              persist({ ...current.current, category: category as Category })
            }
            className="theme-options"
            aria-label="質問のテーマ"
            disabled={!ready || busy || !!draft.pending}
          >
            {CATEGORIES.map((category, i) => (
              <label className="theme-option" key={category}>
                <RadioGroupItem
                  value={category}
                  id={`theme-${i}`}
                  className="theme-radio"
                />
                <span>{category}</span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>

        <div className="question-reassurance">
          <LockKeyhole size={16} aria-hidden="true" />
          <strong>名前・ログインは不要です。</strong>
        </div>

        <p className="consent">
          送信すると、運営による閲覧・集計とイベントでの紹介に同意したものとします。すべての質問に回答できるとは限りません。
        </p>

        <div
          id="question-error"
          className={error ? 'notice notice-error' : ''}
          role="alert"
        >
          {error}
        </div>

        {offline && (
          <p className="notice" role="status">
            オフラインです。入力内容を残したまま、接続をお待ちください。
          </p>
        )}

        {storageUnavailable && (
          <p className="muted">
            このブラウザーでは下書きを保存できません。送信するまで画面を閉じないでください。
          </p>
        )}

        {remaining > 0 && (
          <p className="muted">
            再送まで {Math.floor(remaining / 60)}分{remaining % 60}秒
          </p>
        )}

        <div className="submit-area">
          <ActionButton
            type="submit"
            className="full-width send-button"
            busy={busy}
            disabled={
              !ready ||
              busy ||
              offline ||
              remaining > 0 ||
              !draft.body.trim() ||
              (!event.open && !draft.pending)
            }
          >
            {draft.pending && (!busy || isCheckingPending) ? (
              busy ? '確認中…' : '送信結果を確認'
            ) : (
              <>
                質問を送る
                <span
                  className={`airplane-deco ${isFlying ? 'is-flying' : ''}`}
                  aria-hidden="true"
                >
                  <Send size={18} />
                </span>
              </>
            )}
          </ActionButton>

          <p className="submit-status muted" role="status">
            {slow
              ? '確認に時間がかかっています。この画面でお待ちください'
              : busy
              ? isCheckingPending
                ? '送信結果を確認しています'
                : '質問を送っています'
              : draft.pending
              ? '同じ質問が重複して送られることはありません。'
              : !event.open
              ? 'このルームは受付を終了しました。'
              : !draft.body.trim()
              ? '質問を入力すると送信できます。'
              : ''}
          </p>
        </div>
      </form>

      <ConfirmDialog
        open={editPending}
        onOpenChange={setEditPending}
        title="送信結果が未確認です"
        description="前の質問はすでに受け付けられている可能性があります。変更後は新しい投稿になるため、同じ質問が重複する場合があります。"
        action="新しい投稿として編集"
        onConfirm={() => {
          persist({ ...current.current, pending: undefined });
          setError('');
          requestAnimationFrame(() => bodyInput.current?.focus());
        }}
      />
    </div>
  );
}
