'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, RefreshCw } from 'lucide-react';
import { ApiError, getAdminReport, type EventItem, type ReportData } from '@/lib/api-client';
import { appendReport, newQuestionCount } from '@/lib/report-state';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { ActionButton } from './action-button';
import { EventSettings } from './event-settings';

export type AdminTab = 'questions' | 'analysis' | 'settings';
const time = (value: number) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function EventWorkspace({ event, token, tab, onSaved, onAuthError }: {
  event: EventItem; token: string; tab: AdminTab; onSaved: (event: EventItem) => void; onAuthError: () => void;
}) {
  const [report, setReport] = useState<ReportData | null>(null);
  const snapshot = useRef<ReportData | null>(null);
  const [latest, setLatest] = useState<ReportData | null>(null);
  const [lastSuccess, setLastSuccess] = useState(0);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null);
  const manual = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; manual.current?.abort(); generation.current += 1; }; }, []);
  const poll = useForegroundPoll(async (signal) => {
    if (manual.current) return;
    const version = generation.current;
    try {
      const result = await getAdminReport(token, event.id, snapshot.current ? 1 : 50, null, signal);
      if (signal.aborted || version !== generation.current) return;
      if (!snapshot.current) { snapshot.current = result; setReport(result); }
      setLatest(result); setLastSuccess(Date.now()); setError('');
    } catch (e) {
      if (signal.aborted || version !== generation.current) return;
      if (e instanceof ApiError && [401, 403].includes(e.statusCode)) { onAuthError(); return; }
      setError('更新できていません。取得済みの質問はそのまま読めます。'); throw e;
    }
  }, tab === 'analysis' ? 15000 : 3000, tab !== 'settings', `${event.id}:${token}`);

  async function load(mode: 'refresh' | 'more') {
    if (manual.current || (mode === 'more' && !snapshot.current?.nextCursor)) return;
    const controller = new AbortController(); manual.current = controller; generation.current += 1;
    setBusy(mode); setPageError('');
    try {
      const result = await getAdminReport(token, event.id, 50, mode === 'more' ? snapshot.current?.nextCursor : null, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      const next = mode === 'more' && snapshot.current ? appendReport(snapshot.current, result) : result;
      snapshot.current = next; setReport(next); setError(''); setLastSuccess(Date.now());
      if (mode === 'refresh') { setLatest(result); setExpired(false); requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }); }
    } catch (e) {
      if (controller.signal.aborted || !alive.current) return;
      if (e instanceof ApiError && [401, 403].includes(e.statusCode)) { onAuthError(); return; }
      if (e instanceof ApiError && ['CURSOR_EXPIRED', 'INVALID_CURSOR'].includes(e.code)) {
        setExpired(true); setPageError('一覧の取得期限が切れました。読んでいる質問を残しています。一覧を更新すると続きを取得できます。');
      } else setPageError('読み込めませんでした。通信状況を確認して、もう一度お試しください。');
    } finally { if (manual.current === controller) manual.current = null; if (alive.current) setBusy(null); }
  }
  const newCount = report && latest ? newQuestionCount(report, latest) : 0;
  const data = latest || report;
  return <div>
    <section hidden={tab !== 'questions'} aria-label="質問一覧" className="questions-workspace">
      <div className="workspace-heading"><div><p className="eyebrow">QUESTIONS</p><h1 ref={heading} tabIndex={-1}>届いた質問 <span className="count-tag">{report?.total ?? '—'}</span></h1></div><ActionButton tone="quiet" disabled={!!busy} onClick={() => void load('refresh')} aria-label="一覧を更新"><RefreshCw size={19} /></ActionButton></div>
      <p className="update-status" role="status">{poll.paused ? '自動更新を一時停止中' : error ? '更新できていません' : '自動更新'}{lastSuccess > 0 && ` · 最終確認 ${time(lastSuccess)}`}</p>
      {error && <p className="notice notice-error" role="alert">{error}<ActionButton tone="quiet" onClick={poll.refresh}>再試行</ActionButton></p>}
      <div className="new-questions-slot" aria-live="polite" aria-atomic="true">
        {newCount > 0 ? <ActionButton className="new-questions-button" busy={busy === 'refresh'} disabled={!!busy} onClick={() => void load('refresh')}><ArrowUp size={17} />新しい質問が{newCount}件 · 表示する</ActionButton> : <span className="muted">質問は新しい順に表示します。</span>}
      </div>
      {!report && !error && <div className="surface form-loading" role="status"><div className="skeleton-line" /><div className="skeleton-input" /><p>質問を読み込み中…</p></div>}
      {report && !report.rows.length && <div className="empty-state surface"><MessageCircle size={30} /><h2>最初の質問を待っています</h2><p>届いた質問はここに表示されます。</p></div>}
      <div className="question-list">{report?.rows.map((q) => <article className="question-row" key={q.id}><div className="question-meta"><span>{q.category}</span><time dateTime={new Date(q.created_at).toISOString()}>{new Date(q.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</time></div><p className="question-body">{q.body}</p><p className="question-source">{q.source === 'instagram' ? 'Instagramリンク経由' : 'Webから'} · 匿名</p></article>)}</div>
      {pageError && <p className="notice notice-error" role="alert">{pageError}</p>}
      <div className="pagination-area">{expired ? <ActionButton tone="secondary" busy={busy === 'refresh'} onClick={() => void load('refresh')}>一覧を更新</ActionButton> : report?.hasNext && <ActionButton tone="secondary" className="full-width" busy={busy === 'more'} disabled={!!busy} onClick={() => void load('more')}>{busy === 'more' ? '読み込み中…' : 'さらに読み込む'}</ActionButton>}{report && <p className="muted" role="status">{report.rows.length} / {report.total}件{report.generatedAt ? ` · ${time(report.generatedAt)}時点` : ''}</p>}</div>
    </section>
    <section hidden={tab !== 'analysis'} className="analysis-workspace" aria-label="質問の集計">
      <div className="workspace-heading"><div><p className="eyebrow">INSIGHTS</p><h1>質問の集計</h1></div><ActionButton tone="quiet" disabled={!!busy} onClick={poll.refresh} aria-label="集計を更新"><RefreshCw size={19} /></ActionButton></div>
      <p className="update-status" role="status">{error ? '更新できていません' : poll.paused ? '自動更新を一時停止中' : '15秒ごとに更新'}{data && ` · ${time(data.generatedAt)}時点`}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!data ? <p role="status">集計を読み込み中…</p> : <>
        <div className="stat-grid"><div><span>届いた質問</span><strong>{data.total}<small>件</small></strong></div><div><span>Instagramリンク経由</span><strong>{data.sources.find((s) => s.source === 'instagram')?.count || 0}<small>件</small></strong></div><div><span>質問のテーマ</span><strong>{data.categories.length}<small>種類</small></strong></div></div>
        <div className="analysis-grid"><section className="surface"><h2>テーマ別</h2>{data.categories.map((c) => <div className="category-stat" key={c.category}><div><span>{c.category}</span><strong>{c.count}件 <small>{Math.round(c.count / (data.total || 1) * 100)}%</small></strong></div><meter min={0} max={data.total || 1} value={c.count} aria-label={`${c.category} ${c.count}件`} /></div>)}{!data.categories.length && <p className="muted">質問が届くと内訳が表示されます。</p>}</section><section className="surface"><h2>日別</h2><p className="muted">投稿のあった直近30日 · 日本時間</p>{data.days.map((day) => <div className="daily-stat" key={day.day}><time>{day.day}</time><strong>{day.count}件</strong></div>)}{!data.days.length && <p className="muted">まだ質問はありません。</p>}</section></div>
        <p className="muted">流入元は募集リンクに基づく集計です。実際に使用したアプリを特定するものではありません。</p>
      </>}
    </section>
    <section hidden={tab !== 'settings'} aria-label="イベント設定"><EventSettings event={event} token={token} onSaved={onSaved} onAuthError={onAuthError} /></section>
  </div>;
}
