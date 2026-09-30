'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  Edit3,
  LockKeyhole,
  Plane,
  ChevronDown,
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

type FormStep = 'write' | 'folding' | 'prepared';

function PaperAirplaneSvg() {
  return (
    <svg
      className="airplane-svg"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Left Wing */}
      <path
        d="M50 12 L12 84 L50 68 Z"
        fill="#ffffff"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Right Wing */}
      <path
        d="M50 12 L88 84 L50 68 Z"
        fill="#f4f4f2"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Center Keel & Fold Accents */}
      <path
        d="M50 12 L50 68 L44 84 Z"
        fill="#e2e2dc"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M50 12 L50 68 L56 84 Z"
        fill="#c8c8c2"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [complete, setComplete] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [remaining, setRemaining] = useState(0);

  // Paper airplane interaction state
  const [step, setStep] = useState<FormStep>('write');
  const [isFlying, setIsFlying] = useState(false);
  const [dragDist, setDragDist] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReadyToLaunch, setIsReadyToLaunch] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const stageDialog = useRef<HTMLDialogElement>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);

  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const runwayRef = useRef<HTMLDivElement>(null);

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
      setDraft(saved);
      // If there is an unconfirmed pending submission, start in prepared view
      if (saved.pending) {
        setStep('prepared');
      }
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
    if (complete) completeHeading.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (step === 'write' && !complete) return;
    const dialog = stageDialog.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (complete) completeHeading.current?.focus();
    else if (step === 'prepared') stageHeading.current?.focus();
    const cancelDrag = () => {
      activePointerId.current = null;
      setIsDragging(false);
      setDragDist(0);
      setIsReadyToLaunch(false);
    };
    document.addEventListener('visibilitychange', cancelDrag);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('visibilitychange', cancelDrag);
    };
  }, [step, complete]);

  function returnToPaper() {
    if (sending.current) return;
    setPreviewOpen(false);
    setStep('write');
    setDragDist(0);
    setIsReadyToLaunch(false);
    requestAnimationFrame(() => bodyInput.current?.focus());
  }

  function startFold() {
    if (!current.current.body.trim()) {
      setError('質問を入力してください。');
      bodyInput.current?.focus();
      return;
    }
    setError('');
    // Dismiss virtual keyboard
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setStep('prepared');
    } else {
      setStep('folding');
      setTimeout(() => {
        if (mounted.current) setStep('prepared');
      }, 420);
    }
  }

  async function launchAirplane(initialDist = 0) {
    if (
      sending.current ||
      !ready ||
      !navigator.onLine ||
      (current.current.retryAt || 0) > Date.now() ||
      (!event.open && !current.current.pending)
    ) {
      return;
    }
    if (!current.current.body.trim()) {
      setStep('write');
      setError('質問を入力してください。');
      bodyInput.current?.focus();
      return;
    }

    sending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');

    // Trigger visual launch animation
    setIsFlying(!current.current.pending);
    setDragDist(initialDist);

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
      if (!result.ok || !result.id) throw new Error('送信結果を確認できませんでした。');

      if (mounted.current) {
        persist(emptyDraft());
        setComplete(true);
        setStep('write');
        setIsFlying(false);
        setDragDist(0);
        setIsReadyToLaunch(false);
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
      setDragDist(0);
      setIsReadyToLaunch(false);

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
        setStep('write');
      } else {
        setError(
          '送信結果を確認できませんでした。内容を保持しています。同じ内容でもう一度確認できます。'
        );
      }
    } finally {
      sending.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  // Pointer event handlers for the upward swipe gesture on runway
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 複数指操作の検知：すでに操作中の指があるか、プライマリでない場合はキャンセル
    if (activePointerId.current !== null || !e.isPrimary) {
      if (activePointerId.current !== null) {
        try {
          e.currentTarget.releasePointerCapture(activePointerId.current);
        } catch {}
        activePointerId.current = null;
        setIsDragging(false);
        setDragDist(0);
        setIsReadyToLaunch(false);
      }
      return;
    }

    if (step !== 'prepared' || busy || sending.current || offline || remaining > 0 || draft.pending || e.button !== 0) return;
    if (!event.open && !draft.pending) return;

    activePointerId.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    dragStart.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    setDragDist(0);
    setIsReadyToLaunch(false);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging || busy || sending.current) return;
    // 記録した pointerId 以外からのイベントは無視
    if (activePointerId.current === null || e.pointerId !== activePointerId.current) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // reduced-motion が有効な場合は指への追従移動を無効化
    if (prefersReducedMotion) {
      setDragDist(0);
      setIsReadyToLaunch(false);
      return;
    }

    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    if (dy < 0) {
      const upwardPx = -dy;
      const isValidAngle = Math.abs(dy) >= 1.5 * Math.abs(dx);
      setDragDist(upwardPx);
      setIsReadyToLaunch(upwardPx >= 80 && isValidAngle);
    } else {
      setDragDist(0);
      setIsReadyToLaunch(false);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging || activePointerId.current === null) return;
    if (e.pointerId !== activePointerId.current) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    activePointerId.current = null;
    setIsDragging(false);

    const dy = dragStart.current.y - e.clientY;
    const dx = e.clientX - dragStart.current.x;
    if (isReadyToLaunch && dy >= 80 && dy >= 1.5 * Math.abs(dx)) {
      void launchAirplane(dy);
    } else {
      // Smooth reset back to base position
      setDragDist(0);
      setIsReadyToLaunch(false);
    }
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current !== null && e.pointerId === activePointerId.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      activePointerId.current = null;
      setIsDragging(false);
      setDragDist(0);
      setIsReadyToLaunch(false);
    }
  }

  if (complete) {
    return (
      <dialog ref={stageDialog} className="flight-dialog" aria-labelledby="complete-title" onCancel={(e) => e.preventDefault()}>
      <section className="completion flight-completion" aria-labelledby="complete-title">
        <span className="completion-check">
          <Check size={38} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <p className="eyebrow">THANK YOU</p>
        <h1 id="complete-title" tabIndex={-1} ref={completeHeading}>
          質問を受け付けました
        </h1>
        <p>
          運営が確認し、イベントで
          <br className="mobile-break" />
          紹介する場合があります。
        </p>
        <ActionButton
          type="button"
          className="full-width"
          onClick={() => {
            setComplete(false);
            setError('');
            requestAnimationFrame(() => bodyInput.current?.focus());
          }}
        >
          もう1件質問する <ArrowRight size={19} />
        </ActionButton>
        <ShareControls eventId={event.id} title={event.title} />
      </section>
      </dialog>
    );
  }

  return (
    <div className="paper-container">
      {/* 1. Write step (紙面入力) */}
      {step === 'write' && (
        <form
          className="question-form paper-sheet"
          onSubmit={(e) => {
            e.preventDefault();
            startFold();
          }}
          aria-busy={!ready || busy}
        >
          <div className="question-heading">
            <span className="question-number" aria-hidden="true">
              Q.
            </span>
            <h1>
              <label htmlFor="question-body">聞いてみたいこと</label>
            </h1>
          </div>

          {!event.open && (
            <p className="notice" role="status">
              このルームは受付を終了しました。
              {draft.pending
                ? '前回の送信結果は確認できます。'
                : '入力した内容は残しています。'}
            </p>
          )}

          {draft.pending && !busy && (
            <div className="notice">
              <p>
                前回の送信結果が未確認です。同じ内容で確認すると、重複せずに結果を受け取れます。
              </p>
              <div className="button-row" style={{ marginTop: '8px' }}>
                <ActionButton
                  type="button"
                  tone="secondary"
                  onClick={() => launchAirplane()}
                >
                  同じ内容で送信結果を確認
                </ActionButton>
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

          <textarea
            id="question-body"
            ref={bodyInput}
            className="question-input"
            placeholder="例えば、入学前にやっておいてよかったことは？"
            value={draft.body}
            maxLength={500}
            readOnly={busy || !!draft.pending}
            disabled={!ready}
            aria-describedby="question-note question-count question-error"
            aria-invalid={!!error || undefined}
            onChange={(e) => {
              persist({ ...current.current, body: e.target.value });
              setError('');
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
              className="full-width"
              busy={false}
              disabled={
                !ready ||
                offline ||
                remaining > 0 ||
                !draft.body.trim() ||
                (!event.open && !draft.pending)
              }
            >
              紙飛行機にする
              <Plane size={18} aria-hidden="true" style={{ transform: 'rotate(-45deg)' }} />
            </ActionButton>
            <p className="submit-status muted" role="status">
              {!draft.body.trim()
                ? '質問を入力すると紙飛行機にできます。'
                : '折ったあと、上にスワイプして送信します。'}
            </p>
          </div>
        </form>
      )}

      {step !== 'write' && <dialog ref={stageDialog} className="flight-dialog" aria-label="質問を送る" onCancel={(e) => { e.preventDefault(); if (step === 'prepared') returnToPaper(); }}>
      <div className="flight-layout">
      <header className="flight-header">
        <span className="flight-room">{event.title}</span>
        <ActionButton type="button" tone="quiet" disabled={busy || step === 'folding'} onClick={returnToPaper}>
          <Edit3 size={16} aria-hidden="true" />書き直す
        </ActionButton>
      </header>
      {/* 2. Prepared step (折り畳み完了・スワイプ & タップ送信) */}
      {(step === 'prepared' || step === 'folding') && (
        <div className="prepared-view" aria-label="送信準備">
          <div className="flight-heading">
            <p className="eyebrow">{busy ? 'SENDING' : draft.pending ? '確認待ち' : 'READY TO FLY'}</p>
            <h1 ref={stageHeading} tabIndex={-1}>{busy ? '質問を届けています' : draft.pending ? '送信結果を確認します' : 'あなたの質問を、飛ばそう。'}</h1>
          </div>
          <div className="paper-preview-card">
            <div className="paper-preview-header">
              <span
                className="theme-badge"
                data-category={draft.category}
                style={{ fontSize: '.8125rem' }}
              >
                {draft.category}
              </span>
              <ActionButton type="button" tone="quiet" disabled={step === 'folding'} aria-expanded={previewOpen} aria-controls="flight-question" onClick={() => setPreviewOpen(!previewOpen)}>
                {previewOpen ? '閉じる' : '内容を確認'}<ChevronDown size={16} aria-hidden="true" style={{ transform: previewOpen ? 'rotate(180deg)' : undefined }} />
              </ActionButton>
            </div>
            <div id="flight-question" className={`paper-preview-body ${previewOpen ? 'is-expanded' : ''}`}>{previewOpen ? draft.body : `${draft.body.slice(0, 48)}${draft.body.length > 48 ? '…' : ''}`}</div>
          </div>

          {draft.pending && !busy && (
            <div className="notice">
              <p>前回の送信結果が未確認です。同じ内容で確認すると、重複せずに受け取れます。</p>
            </div>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}

          {/* Interactive Runway for Swipe Gesture */}
          <div
            ref={runwayRef}
            className={`airplane-runway ${isReadyToLaunch ? 'is-ready' : ''} ${isDragging ? 'is-dragging' : ''} ${busy || draft.pending ? 'is-sending' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            aria-label="紙飛行機を上へスワイプして送信する領域"
          >
            {/* 80px Threshold line */}
            <div className={`runway-threshold-line ${isReadyToLaunch ? 'is-ready' : ''}`}>
              <span className="threshold-label">
                {isReadyToLaunch ? '指を離して送信' : 'ここまで引き上げる'}
              </span>
            </div>

            {/* Instruction text with bounce arrow */}
            <div className={`runway-instruction ${isReadyToLaunch ? 'is-ready' : ''}`}>
              {!isReadyToLaunch && !busy && !draft.pending && <ArrowUp size={20} className="runway-arrow" aria-hidden="true" />}
              <span>{step === 'folding' ? '紙飛行機に折っています…' : busy ? '受付を確認しています…' : draft.pending ? '内容は保存されています' : isReadyToLaunch ? '指を離して飛ばす' : '上にスワイプして送信'}</span>
            </div>

            {step === 'folding' && <div className="origami-stage" aria-label="紙飛行機へ折り畳み中">
              <div className="origami-sheet" aria-hidden="true">
                <div className="origami-body"><p className="origami-excerpt">{draft.body.slice(0, 80)}</p></div>
                <div className="origami-wing origami-wing-left" />
                <div className="origami-wing origami-wing-right" />
                <div className="origami-crease-spine" />
                <div className="origami-plane-emerge"><PaperAirplaneSvg /></div>
              </div>
            </div>}

            {/* Paper Airplane */}
            {step === 'prepared' && <div
              className={`paper-airplane-wrapper ${isReadyToLaunch ? 'is-ready' : ''} ${
                isFlying ? 'is-flying' : ''
              }`}
              style={{
                transform:
                  typeof window !== 'undefined' &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'none'
                    : `translateY(${-dragDist}px)`,
                transition: isDragging ? 'none' : 'transform 160ms ease-out',
                '--fly-start': `${-dragDist}px`,
              } as CSSProperties}
            >
              <PaperAirplaneSvg />
            </div>}
          </div>

          {/* Accessible Alternative: Tap to Send Button */}
          <div className="submit-area">
            {offline && <p className="notice" role="status">オフラインです。内容を残して接続を待っています。</p>}
            {!event.open && !draft.pending && <p className="notice" role="status">このルームは受付を終了しました。</p>}
            <ActionButton
              type="button"
              className="full-width tap-send-button"
              busy={busy}
              disabled={
                step === 'folding' ||
                !ready ||
                offline ||
                remaining > 0 ||
                !draft.body.trim() ||
                (!event.open && !draft.pending)
              }
              onClick={() => launchAirplane()}
            >
              {busy ? (
                '送信中…'
              ) : draft.pending ? (
                '同じ内容で送信結果を確認'
              ) : (
                <>
                  タップして送信
                  <Send size={18} aria-hidden="true" />
                </>
              )}
            </ActionButton>
            <p className="submit-status muted" role="status">
              {slow
                ? '送信に時間がかかっています。入力内容は保持しています。'
                : busy ? 'この画面で受付完了をお待ちください。' : draft.pending ? '同じ質問が重複して送られることはありません。' : 'まだ送信されていません。'}
            </p>
          </div>
        </div>
      )}
      </div>
      </dialog>}

      <ConfirmDialog
        open={editPending}
        onOpenChange={setEditPending}
        title="送信結果が未確認です"
        description="前の質問はすでに受け付けられている可能性があります。変更後は新しい投稿になるため、同じ質問が重複する場合があります。"
        action="新しい投稿として編集"
        onConfirm={() => {
          persist({ ...current.current, pending: undefined });
          setError('');
          setStep('write');
          requestAnimationFrame(() => bodyInput.current?.focus());
        }}
      />
    </div>
  );
}
