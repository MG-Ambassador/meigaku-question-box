'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, House, LockKeyhole } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiError, submitQuestion, type EventItem } from '@/lib/api-client';
import { resolvePublicPath } from '@/lib/public-url';
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
import { ConfirmDialog } from './confirm-dialog';
import { SealedLetter } from './sealed-letter';

const THEME_HINTS: Record<Category, string> = {
  '大学生活': 'サークル・キャンパス・一日の過ごし方',
  '学び・授業': '学科・ゼミ・時間割',
  '入試・進路': '受験・就職・資格',
  '留学・国際交流': '留学制度・語学・海外との交流',
  'その他': '迷ったときはこちらへ',
};

export function QuestionForm({
  event,
  onBusyChange,
  onStageChange,
  onClosed,
}: {
  event: EventItem;
  onBusyChange: (busy: boolean) => void;
  /** 1–3 = 入力のステップ、0 = 受付完了。扉の窓を出し分けるために使う。 */
  onStageChange?: (stage: number) => void;
  onClosed: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = useRef(draft);
  const sending = useRef(false);
  const mounted = useRef(true);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [sent, setSent] = useState<{ category: Category; body: string; at: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [complete, setComplete] = useState(false);
  const [step, setStep] = useState(1);
  const stepHeading = useRef<HTMLHeadingElement>(null);
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
      setStep(saved.pending ? 3 : saved.body ? 2 : 1);
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
    onStageChange?.(complete ? 0 : step);
  }, [complete, step, onStageChange]);

  useEffect(() => {
    if (complete) {
      completeHeading.current?.focus();
    }
  }, [complete]);

  function moveTo(next: number) {
    setStep(next);
    setError('');
    requestAnimationFrame(() => stepHeading.current?.focus());
  }

  function advance() {
    if (step === 2 && !current.current.body.trim()) {
      setError('聞いてみたいことをひとこと書いてください。');
      bodyInput.current?.focus();
      return;
    }
    moveTo(step + 1);
  }

  async function handleSend() {
    if (
      sending.current ||
      !ready ||
      step !== 3 ||
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
        setSent({ category: pending.category, body: pending.body, at: Date.now() });
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
      sending.current = false;
      if (mounted.current) {
        setBusy(false);
        setIsCheckingPending(false);
        onBusyChange(false);
      }
    }
  }

  if (complete) {
    const time = sent
      ? new Date(sent.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
      : '';
    return (
      <section className="completion in-page-completion" aria-labelledby="complete-title">
        <SealedLetter body={sent?.body} />
        <p className="eyebrow eyebrow-ink completion-eyebrow">受付完了 · RECEIVED</p>
        <h1 id="complete-title" tabIndex={-1} ref={completeHeading}>
          <span className="sk-mark">質問を受け付けました</span>
        </h1>
        {sent && <p className="received-meta">{sent.category} · {time}</p>}
        <p className="completion-lede">運営に届けました。イベントで紹介・回答する場合があります。</p>
        <p className="completion-note">この画面は閉じて大丈夫です。すべての質問への回答や、個別の通知はありません。</p>
        <div className="completion-mark">
          {/* eslint-disable-next-line @next/next/no-img-element -- Static export serves the official SVG as-is. */}
          <img src={resolvePublicPath('/brand/mg-ring.svg')} alt="明治学院大学" width={56} height={56} />
        </div>
        <div className="completion-actions">
          <ActionButton
            type="button"
            className="full-width"
            tone="secondary"
            onClick={() => {
              setComplete(false);
              setSent(null);
              setError('');
              setStep(1);
              // ① ルームの扉（アーチの窓）から見せる。見出しへのフォーカスで扉が隠れないよう、先頭に戻してからフォーカスする。
              requestAnimationFrame(() => {
                window.scrollTo({ top: 0 });
                stepHeading.current?.focus({ preventScroll: true });
              });
            }}
          >
            <House size={18} aria-hidden="true" />HOMEに戻る
          </ActionButton>
        </div>
      </section>
    );
  }

  return (
    <div className="question-container">
      <form
        className="question-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 3) advance();
          else void handleSend();
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

        <ol className="question-steps" aria-label="質問のステップ">
          {['テーマ', '質問', '確認'].map((label, index) => (
            <li key={label} aria-current={step === index + 1 ? 'step' : undefined}>
              <span>{String(index + 1).padStart(2, '0')}</span>{label}
            </li>
          ))}
        </ol>
        <div className="question-heading">
          <h1 ref={stepHeading} tabIndex={-1}>
            {step === 1 ? '何についての質問ですか' : step === 2 ? '聞いてみたいこと' : 'この内容で投函します'}
          </h1>
        </div>
        <p className="step-intro">
          {step === 1 ? '近いテーマをひとつ選んでください。迷ったら「その他」で大丈夫です。' : step === 2 ? '小さな疑問も、ご自身の言葉で。' : '送ったあとは取り消せません。内容をもう一度ご確認ください。'}
        </p>
        <div hidden={step !== 1}>
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
                  aria-describedby={`theme-hint-${i}`}
                />
                <span className="theme-option-text">
                  <span>{category}</span>
                  <small id={`theme-hint-${i}`} aria-hidden="true">{THEME_HINTS[category]}</small>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>

        </div>
        <div hidden={step !== 2 && !draft.pending}>
        <p className="review-theme letter-theme">{draft.category}</p>
        <label className="sr-only" htmlFor="question-body">聞いてみたいこと</label>
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
          aria-invalid={step === 2 && !!error || undefined}
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

        </div>
        {step === 3 && !draft.pending && (
          <div className="question-review envelope">
            <span className="stamp-box" aria-hidden="true">受付印</span>
            <dl>
              <dt>テーマ</dt>
              <dd>{draft.category}</dd>
              <dt>質問</dt>
              <dd className="review-body">{draft.body}</dd>
            </dl>
            <ActionButton type="button" tone="quiet" disabled={busy} onClick={() => moveTo(2)}>質問を直す</ActionButton>
          </div>
        )}

        <div className="question-reassurance">
          <LockKeyhole size={16} aria-hidden="true" />
          <strong>名前・ログインは不要です。</strong>
        </div>

        <p className="consent" hidden={step !== 3}>
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
          {step > 1 && !draft.pending && (
            <ActionButton type="button" tone="quiet" disabled={busy} onClick={() => moveTo(step - 1)}>
              <ArrowLeft size={18} aria-hidden="true" />戻る
            </ActionButton>
          )}
          <ActionButton
            type="submit"
            className="full-width send-button"
            busy={busy}
            disabled={
              !ready ||
              busy ||
              offline ||
              remaining > 0 ||
              (step === 3 && !draft.body.trim()) ||
              (!event.open && !draft.pending)
            }
          >
            {step < 3 ? (
              <>{step === 1 ? '質問を書く' : '内容を確認する'}<ArrowRight size={18} aria-hidden="true" /></>
            ) : draft.pending && (!busy || isCheckingPending) ? (
              busy ? '確認中…' : '送信結果を確認'
            ) : (
              '投函する'
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
              : step === 2 && !draft.body.trim()
              ? '何を知りたいか、ひとことからで大丈夫です。'
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
          moveTo(2);
          requestAnimationFrame(() => bodyInput.current?.focus());
        }}
      />
    </div>
  );
}
