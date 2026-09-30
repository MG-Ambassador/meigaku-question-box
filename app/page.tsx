'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, HelpCircle, MessageCircle } from 'lucide-react';
import { ApiError, getPublicEvent, getPublicEvents, type EventItem } from '@/lib/api-client';
import { resolvePublicPath } from '@/lib/public-url';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { QuestionForm } from '@/components/question-box/question-form';

export default function Home() {
  const [eventId, setEventId] = useState('');
  const [event, setEvent] = useState<EventItem | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [booted, setBooted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    function readLocation() { setBusy(false); setEventId(new URLSearchParams(window.location.search).get('event') || ''); setEvent(null); setLoading(true); setNotFound(false); setError(''); }
    readLocation(); setBooted(true);
    window.addEventListener('popstate', readLocation); return () => window.removeEventListener('popstate', readLocation);
  }, []);

  function choose(id: string, push = true) {
    const url = new URL(window.location.href); url.searchParams.set('event', id);
    if (push) window.history.pushState(null, '', `${url.pathname}${url.search}`);
    else window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    setEventId(id); setEvent(null); setLoading(true); setNotFound(false); setError(''); setPicker(false);
  }

  const poll = useForegroundPoll(async (signal) => {
    try {
      if (eventId) {
        const result = await getPublicEvent(eventId, signal);
        if (!signal.aborted) { setEvent(result); setNotFound(false); }
      } else {
        const result = await getPublicEvents(signal);
        if (!signal.aborted) {
          setEvents(result);
          if (result.length === 1) choose(result[0].id, false);
        }
      }
      if (!signal.aborted) { setError(''); setLoading(false); }
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.statusCode === 404) { setNotFound(true); setEvent(null); setError('イベントが見つかりません。共有されたリンクをご確認ください。'); }
      else setError('イベント情報を読み込めませんでした。通信状況を確認して、もう一度お試しください。');
      setLoading(false); throw e;
    }
  }, 30000, booted && !busy, eventId);

  async function openPicker() {
    setPicker(true); setPickerLoading(true); setPickerError('');
    try { setEvents(await getPublicEvents()); }
    catch { setPickerError('イベント一覧を読み込めませんでした。'); }
    finally { setPickerLoading(false); }
  }

  return <div className="visitor-shell">
    <a href="#main-content" className="skip-link">質問入力へ移動</a>
    <header className="visitor-header"><a href={resolvePublicPath('/')} className="wordmark" aria-label="明学の質問箱 ホーム"><span className="brand-symbol" aria-hidden="true">m<span>g</span>.</span><span>明学の質問箱<small>MEIJI GAKUIN UNIVERSITY</small></span></a>
      <ActionButton tone="quiet" className="help-button" onClick={() => setHelp(true)}><HelpCircle size={18} aria-hidden="true" />使い方</ActionButton>
    </header>
    <main id="main-content" className="visitor-main">
      <div className="visitor-caption"><span className="eyebrow">MEIGAKU QUESTION BOX</span><span className="caption-line" /></div>
      {event && <section className="event-context" aria-label="質問するイベント"><div><p className="eyebrow">参加するイベント</p><h2>{event.title}</h2>{event.date && <p className="muted">{event.date}</p>}</div>
        <div className="event-context-actions"><span className={`event-status ${event.open ? 'is-open' : ''}`}>{event.open ? '受付中' : '受付終了'}</span><ActionButton tone="quiet" disabled={busy} onClick={openPicker}>変更<ChevronDown size={16} /></ActionButton></div>
      </section>}
      {error && <div className="notice notice-error" role="alert"><p>{error}</p><ActionButton tone="secondary" onClick={poll.refresh}>もう一度読み込む</ActionButton>{notFound && <ActionButton tone="quiet" onClick={openPicker}>受付中のイベントを選ぶ</ActionButton>}</div>}
      {poll.paused && <p className="notice" role="status">接続を待っています。接続が戻るとイベント情報を確認します。</p>}
      {loading && !event && <div className="form-loading" role="status"><div className="skeleton-line" /><div className="skeleton-input" /><p>イベントを読み込み中…</p></div>}
      {!loading && !event && !error && <section className="event-selection"><span className="empty-symbol"><MessageCircle size={30} /></span><h1>{events.length ? '参加するイベントを選ぶ' : 'ただいま受付準備中です'}</h1><p className="muted">{events.length ? '質問を届けたいイベントを選んでください。' : '受付が始まると、ここから質問できます。'}</p><div className="event-list">{events.map((item) => <ActionButton key={item.id} tone="secondary" onClick={() => choose(item.id)}><span>{item.title}<small>{item.date}</small></span><ArrowRight size={20} /></ActionButton>)}</div></section>}
      {event && <QuestionForm key={event.id} event={event} onBusyChange={setBusy} onClosed={() => { setEvent((current) => current ? { ...current, open: 0 } : current); poll.refresh(); }} />}
    </main>
    <footer className="visitor-footer"><span>ひとつの問いが、誰かのために。</span><span>Do for Others</span></footer>
    <AppSheet open={picker} onOpenChange={setPicker} title="イベントを選ぶ" description="入力途中の質問は、イベントごとに保持されます。">
      {pickerLoading ? <p role="status">読み込み中…</p> : pickerError ? <div className="notice notice-error" role="alert">{pickerError}<ActionButton tone="secondary" onClick={openPicker}>再読み込み</ActionButton></div> : <div className="event-list">{events.map((item) => <ActionButton tone="secondary" key={item.id} onClick={() => choose(item.id)}><span>{item.title}<small>{item.date}</small></span><ArrowRight size={20} /></ActionButton>)}{!events.length && <p>受付中のイベントはありません。</p>}</div>}
    </AppSheet>
    <AppSheet open={help} onOpenChange={setHelp} title="気軽に、安心して質問するために" description="名前もログインもいりません。質問への回答はイベントで行います。">
      <div className="help-copy"><h3>質問の送り方</h3><p>参加するイベントを確認し、聞いてみたいこととテーマを入力して送信してください。</p><h3>質問を見られる人</h3><p>本文は運営担当者だけが閲覧し、イベントの準備と集計に使用します。当日のトークで紹介・回答する場合があります。すべての質問への回答はお約束できません。</p><h3>個人情報について</h3><p>氏名・メールアドレスは入力不要です。あなたや誰かの氏名・連絡先を本文に書かないでください。連投対策に一時的な通信識別情報を使用し、ホスティング事業者のアクセスログに通信情報が残る場合があります。</p><h3>下書きについて</h3><p>このタブの下書きは原則2時間保持し、送信完了時に削除します。タブを閉じると復元できない場合があります。送信結果が分からないときは、同じ内容で再確認できます。</p><h3>Instagramからの参加</h3><p>Instagramのアカウント名も入力不要です。募集リンクからそのまま質問できます。</p></div>
    </AppSheet>
  </div>;
}
