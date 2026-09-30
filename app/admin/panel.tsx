'use client';

import { useEffect, useState } from 'react';
import { BarChart3, LogOut, MessageCircle, Plus, Settings2, Share2, UserRound } from 'lucide-react';
import { getAdminEvents, ApiError, type EventItem } from '@/lib/api-client';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { ShareControls } from '@/components/question-box/share-controls';
import { EventSettings } from '@/components/question-box/event-settings';
import { EventWorkspace, type AdminTab } from '@/components/question-box/event-workspace';

interface PanelProps { token: string; adminUser: { displayName: string; sub: string; email?: string }; onLogout: () => void }
const navigation = [ { id: 'questions', label: '質問', icon: MessageCircle }, { id: 'analysis', label: '集計', icon: BarChart3 }, { id: 'settings', label: '設定', icon: Settings2 } ] as const;

export default function Panel({ token, adminUser, onLogout }: PanelProps) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState<AdminTab>('questions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createRevision, setCreateRevision] = useState(0);
  const [account, setAccount] = useState(false);
  const [share, setShare] = useState(false);
  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get('view');
      setTab(navigation.some((item) => item.id === requestedTab) ? requestedTab as AdminTab : 'questions');
      if (params.has('event')) setEventId(params.get('event') || '');
    }
    restore(); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getAdminEvents(token, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setEvents(items);
      const url = new URL(window.location.href);
      const requested = url.searchParams.get('event');
      const selected = items.some((item) => item.id === requested) ? requested! : items[0]?.id || '';
      setEventId(selected);
      if (selected) {
        url.searchParams.set('event', selected);
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      }
    }).catch((e) => {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && [401, 403].includes(e.statusCode)) onLogout();
      else setError('イベント一覧を読み込めませんでした。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, revision, onLogout]);

  function navigate(nextTab: AdminTab, nextEvent = eventId) {
    if (nextTab === tab && nextEvent === eventId) return;
    const url = new URL(window.location.href); url.searchParams.set('view', nextTab);
    if (nextEvent) url.searchParams.set('event', nextEvent);
    window.history.pushState(null, '', `${url.pathname}${url.search}`); setTab(nextTab); setEventId(nextEvent);
  }
  function saved(item: EventItem) {
    setEvents((previous) => previous.some((e) => e.id === item.id) ? previous.map((e) => e.id === item.id ? item : e) : [item, ...previous]);
    setEventId(item.id);
    if (creating) { setCreating(false); navigate('questions', item.id); }
  }

  return <main className="admin-main">
    <div className="operator-toolbar"><div className="operator-event-field"><label htmlFor="admin-event">イベント</label><select className="field-input" id="admin-event" value={eventId} disabled={!events.length} onChange={(e) => navigate(tab, e.target.value)}><option value="" disabled>イベントを選ぶ</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}{item.open ? '' : '（受付終了）'}</option>)}</select></div>
      <span className={`event-status ${event?.open ? 'is-open' : ''}`}>{event ? event.open ? '受付中' : '受付終了' : '未選択'}</span>
      <div className="operator-tools"><ActionButton tone="quiet" onClick={() => setShare(true)} disabled={!event} aria-label="募集ページを共有"><Share2 size={20} /></ActionButton><ActionButton tone="quiet" onClick={() => setAccount(true)} aria-label="アカウント"><UserRound size={20} /></ActionButton></div>
    </div>
    <nav className="operator-nav" aria-label="運営メニュー">{navigation.map(({ id, label, icon: Icon }) => <ActionButton tone="quiet" key={id} className={tab === id ? 'is-selected' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={21} aria-hidden="true" /><span>{label}</span></ActionButton>)}</nav>
    {loading && <p className="notice" role="status">イベントを読み込み中…</p>}
    {error && <div className="notice notice-error" role="alert"><p>{error}</p><ActionButton tone="secondary" onClick={() => setRevision((n) => n + 1)}>再読み込み</ActionButton></div>}
    {event && <EventWorkspace key={`${token}:${event.id}`} event={event} token={token} tab={tab} onSaved={saved} onAuthError={onLogout} />}
    {!loading && !error && !event && <section className="surface empty-state"><MessageCircle size={32} /><h1>最初のイベントを作りましょう</h1><p>イベントを作成すると、質問の募集を始められます。</p></section>}
    {(tab === 'settings' || (!event && !loading)) && <ActionButton className="create-event-button" tone="secondary" onClick={() => { setCreateRevision((v) => v + 1); setCreating(true); }}><Plus size={19} />新しいイベントを作る</ActionButton>}
    <AppSheet open={account} onOpenChange={setAccount} title="アカウント" description={`${adminUser.displayName} でログイン中`}><ActionButton tone="secondary" onClick={onLogout}><LogOut size={18} />ログアウト</ActionButton></AppSheet>
    <AppSheet open={share} onOpenChange={setShare} title="質問箱を共有する" description={event?.title || ''}>{event && <ShareControls key={event.id} eventId={event.id} title={event.title} operator />}</AppSheet>
    <AppSheet open={creating} onOpenChange={setCreating} title="イベントを作る" description="保存すると、募集リンクを共有できます。"><EventSettings key={createRevision} token={token} onSaved={saved} onAuthError={onLogout} /></AppSheet>
  </main>;
}
