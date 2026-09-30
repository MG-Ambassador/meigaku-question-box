'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, LockKeyhole, Send } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiError, submitQuestion, type EventItem } from '@/lib/api-client';
import { CATEGORIES, emptyDraft, prepareSubmission, readDraft, writeDraft, type Category, type Draft } from '@/lib/question-draft';
import { ActionButton } from './action-button';
import { ShareControls } from './share-controls';
import { ConfirmDialog } from './confirm-dialog';

export function QuestionForm({ event, onBusyChange, onClosed }: { event: EventItem; onBusyChange: (busy: boolean) => void; onClosed: () => void }) {
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
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);

  function persist(next: Draft) {
    const saved = { ...next, savedAt: Date.now() };
    current.current = saved; setDraft(saved);
    try { setStorageUnavailable(!writeDraft(window.sessionStorage, event.id, saved)); }
    catch { setStorageUnavailable(true); }
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = readDraft(window.sessionStorage, event.id);
      current.current = saved; setDraft(saved);
    } catch { setStorageUnavailable(true); }
    setReady(true);
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { mounted.current = false; window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [event.id]);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [busy]);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil(((draft.retryAt || 0) - Date.now()) / 1000)));
    update(); if (!draft.retryAt) return;
    const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [draft.retryAt]);
  useEffect(() => { if (complete) completeHeading.current?.focus(); }, [complete]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || !ready || !navigator.onLine || (current.current.retryAt || 0) > Date.now() || (!event.open && !current.current.pending)) return;
    if (!current.current.body.trim()) { setError('質問を入力してください。'); bodyInput.current?.focus(); return; }
    sending.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const source = new URLSearchParams(window.location.search).get('from') === 'instagram' ? 'instagram' : 'web';
      const pending = prepareSubmission(current.current, event.id, source, () => crypto.randomUUID());
      persist({ ...current.current, pending });
      const result = await submitQuestion(pending);
      if (!result.ok || !result.id) throw new Error('送信結果を確認できませんでした。');
      if (mounted.current) { persist(emptyDraft()); setComplete(true); }
      else {
        // A newer form may already own this event's draft after Back/navigation.
        try {
          const saved = readDraft(window.sessionStorage, event.id);
          if (saved.pending?.requestId === pending.requestId) writeDraft(window.sessionStorage, event.id, emptyDraft());
        } catch { /* Storage may be unavailable; never overwrite a newer draft. */ }
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 408) {
        // A definitive rejection is safe to edit. Network/5xx failures retain the exact payload.
        const next = { ...current.current, pending: undefined };
        if (e.statusCode === 429) {
          next.retryAt = Date.now() + Math.max(1, e.retryAfterSeconds || 600) * 1000;
          setError('続けて投稿されています。表示の時間をおいて、もう一度お試しください。');
        } else if (e.code === 'EVENT_CLOSED' || e.code === 'EVENT_NOT_FOUND') {
          onClosed(); setError('このイベントは質問を受け付けていません。入力内容は残しています。');
        } else setError(e.message);
        persist(next);
      } else setError('送信結果を確認できませんでした。内容を保持しています。同じ内容でもう一度確認できます。');
    } finally { sending.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }

  if (complete) return <section className="completion" aria-labelledby="complete-title">
    <span className="completion-check"><Check size={38} strokeWidth={2.5} aria-hidden="true" /></span>
    <p className="eyebrow">THANK YOU</p>
    <h1 id="complete-title" tabIndex={-1} ref={completeHeading}>質問を受け付けました</h1>
    <p>運営が確認し、イベントで<br className="mobile-break" />紹介する場合があります。</p>
    <ActionButton type="button" className="full-width" onClick={() => { setComplete(false); setError(''); requestAnimationFrame(() => bodyInput.current?.focus()); }}>もう1件質問する <ArrowRight size={19} /></ActionButton>
    <ShareControls eventId={event.id} title={event.title} />
  </section>;

  return <form className="question-form" onSubmit={submit} aria-busy={!ready || busy}>
    <div className="question-heading"><span className="question-number" aria-hidden="true">Q.</span><h1><label htmlFor="question-body">聞いてみたいこと</label></h1></div>
    {!event.open && <p className="notice" role="status">このイベントは受付を終了しました。{draft.pending ? '前回の送信結果は確認できます。' : '入力した内容は残しています。'}</p>}
    {draft.pending && !busy && <div className="notice"><p>前回の送信結果が未確認です。同じ内容で確認すると、重複せずに結果を受け取れます。</p><ActionButton type="button" tone="quiet" onClick={() => setEditPending(true)}>内容を変更する</ActionButton></div>}
    <textarea id="question-body" ref={bodyInput} className="question-input" placeholder="例えば、入学前にやっておいてよかったことは？"
      value={draft.body} maxLength={500} readOnly={busy || !!draft.pending} disabled={!ready}
      aria-describedby="question-note question-count question-error" aria-invalid={!!error || undefined}
      onChange={(e) => { persist({ ...current.current, body: e.target.value }); setError(''); }} />
    <div className="input-meta"><p id="question-note">氏名や連絡先は書かないでください。</p><span id="question-count">{draft.body.length} / 500</span></div>
    <fieldset disabled={!ready || busy || !!draft.pending} className="theme-field"><legend>テーマ</legend>
      <RadioGroup value={draft.category} onValueChange={(category) => persist({ ...current.current, category: category as Category })} className="theme-options" aria-label="質問のテーマ" disabled={!ready || busy || !!draft.pending}>
        {CATEGORIES.map((category, i) => <label className="theme-option" key={category}>
          <RadioGroupItem value={category} id={`theme-${i}`} className="theme-radio" /><span>{category}</span>
        </label>)}
      </RadioGroup>
    </fieldset>
    <div className="question-reassurance"><LockKeyhole size={16} aria-hidden="true" /><strong>名前・ログインは不要です。</strong></div>
    <p className="consent">送信すると、運営による閲覧・集計とイベントでの紹介に同意したものとします。すべての質問に回答できるとは限りません。</p>
    <div id="question-error" className={error ? 'notice notice-error' : ''} role="alert">{error}</div>
    {offline && <p className="notice" role="status">オフラインです。入力内容を残したまま、接続をお待ちください。</p>}
    {storageUnavailable && <p className="muted">このブラウザーでは下書きを保存できません。送信するまで画面を閉じないでください。</p>}
    {remaining > 0 && <p className="muted">再送まで {Math.floor(remaining / 60)}分{remaining % 60}秒</p>}
    <div className="submit-area">
      <ActionButton type="submit" className="full-width" busy={busy} disabled={!ready || offline || remaining > 0 || !draft.body.trim() || (!event.open && !draft.pending)}>
        {busy ? '送信中…' : draft.pending ? '同じ内容でもう一度確認' : '質問を送る'}{!busy && <Send size={19} aria-hidden="true" />}
      </ActionButton>
      <p className="submit-status muted" role="status">{slow ? '送信に時間がかかっています。入力内容は保持しています。' : !draft.body.trim() ? '質問を入力すると送信できます。' : ''}</p>
    </div>
    <ConfirmDialog open={editPending} onOpenChange={setEditPending} title="送信結果が未確認です" description="前の質問はすでに受け付けられている可能性があります。変更後は新しい投稿になるため、同じ質問が重複する場合があります。" action="新しい投稿として編集" onConfirm={() => { persist({ ...current.current, pending: undefined }); setError(''); requestAnimationFrame(() => bodyInput.current?.focus()); }} />
  </form>;
}
