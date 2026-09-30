'use client';

import { useRef, useState } from 'react';
import { ApiError, getPublicEvent, saveAdminEvent, updateAdminEvent, type EventItem } from '@/lib/api-client';
import { Switch } from '@/components/ui/switch';
import { ActionButton } from './action-button';
import { ConfirmDialog } from './confirm-dialog';
import { ShareControls } from './share-controls';

export function EventSettings({ event, token, onSaved, onAuthError }: {
  event?: EventItem; token: string; onSaved: (event: EventItem) => void; onAuthError: () => void;
}) {
  const [baseline, setBaseline] = useState(event);
  const [title, setTitle] = useState(event?.title || '');
  const [date, setDate] = useState(event?.date || '');
  const [accepting, setAccepting] = useState(event ? !!event.open : true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const creationId = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<EventItem | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  async function save() {
    if (lock.current || conflict) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      let saved: EventItem;
      if (baseline) {
        if (!baseline.version) throw new Error('最新のイベント情報を取得してから保存してください。');
        saved = await updateAdminEvent(token, baseline.id, { title, date, open: accepting, version: baseline.version });
      } else {
        creationId.current ||= crypto.randomUUID();
        const result = await saveAdminEvent(token, { id: creationId.current, title, date, open: accepting });
        saved = await getPublicEvent(result.id);
      }
      setBaseline(saved); setTitle(saved.title); setDate(saved.date); setAccepting(!!saved.open);
      setMessage('イベントを保存しました。'); onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 401 || e.statusCode === 403)) { onAuthError(); return; }
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT' && baseline) {
        setError('別の担当者が変更しました。入力内容は残しています。最新情報と比較してください。');
        try { setConflict(await getPublicEvent(baseline.id)); }
        catch { setError('最新情報を取得できませんでした。入力を残しています。再度保存すると確認できます。'); }
      } else setError(e instanceof Error ? e.message : '保存できませんでした。入力内容は残しています。');
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="settings-stack">
    <form className="settings-form surface" onSubmit={(e) => { e.preventDefault(); if (baseline?.open && !accepting) setConfirmStop(true); else void save(); }}>
      <div className="section-heading"><h2>{baseline ? 'イベントの設定' : '新しいイベント'}</h2><p className="muted">来場者に表示する情報を設定します。</p></div>
      <label className="field-label">イベント名<input className="field-input" required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="オープンキャンパス" /></label>
      <label className="field-label">開催日時・会場 <span className="muted">任意</span><input className="field-input" maxLength={100} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} placeholder="10月10日 13:00〜 白金キャンパス" /></label>
      <label className="accepting-control" htmlFor="event-accepting"><span><strong>質問を受け付ける</strong><small>{accepting ? '募集ページから質問を送れます' : '募集ページに受付終了と表示します'}</small></span><Switch id="event-accepting" className="accepting-switch" checked={accepting} onCheckedChange={setAccepting} disabled={busy} /></label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {conflict && <div className="conflict-box"><h3>現在保存されている内容</h3><dl><dt>イベント名</dt><dd>{conflict.title}</dd><dt>開催日時・会場</dt><dd>{conflict.date || '未設定'}</dd><dt>受付</dt><dd>{conflict.open ? '受付中' : '受付終了'}</dd></dl><p>上の入力欄があなたの編集内容です。最新の内容を確認してから保存してください。</p><div className="button-row"><ActionButton type="button" tone="secondary" onClick={() => { setBaseline(conflict); setConflict(null); setError(''); setMessage('最新情報を確認しました。入力内容を保存できます。'); }}>確認して編集を続ける</ActionButton><ActionButton type="button" tone="quiet" onClick={() => { setBaseline(conflict); setTitle(conflict.title); setDate(conflict.date); setAccepting(!!conflict.open); setConflict(null); setError(''); }}>最新の内容を採用</ActionButton></div></div>}
      <ActionButton type="submit" busy={busy} disabled={!title.trim() || !!conflict}>{busy ? '保存中…' : 'イベントを保存'}</ActionButton>
      <p role="status" className="muted">{message}</p>
    </form>
    {baseline && <section className="surface"><div className="section-heading"><h2>質問を募集する</h2><p className="muted">会場やSNSで、このイベントの質問箱を案内できます。</p></div><ShareControls key={baseline.id} operator eventId={baseline.id} title={baseline.title} /></section>}
    <ConfirmDialog open={confirmStop} onOpenChange={setConfirmStop} title="質問の受付を終了しますか？" description={`「${baseline?.title || title}」への新しい質問を停止します。保存済みの質問は引き続き閲覧できます。`} action="受付を終了して保存" onConfirm={() => void save()} />
  </div>;
}
