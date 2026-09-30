'use client';

import { useEffect, useState } from 'react';
import {
  Archive,
  BarChart3,
  FolderArchive,
  LogOut,
  MessageCircle,
  Plus,
  Settings2,
  Share2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { getAdminEvents, ApiError, type EventItem } from '@/lib/api-client';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { ShareControls } from '@/components/question-box/share-controls';
import { EventSettings } from '@/components/question-box/event-settings';
import { EventWorkspace, type AdminTab } from '@/components/question-box/event-workspace';

interface PanelProps {
  token: string;
  adminUser: { displayName: string; sub: string; email?: string };
  onLogout: () => void;
}

const navigation = [
  { id: 'questions', label: '質問', icon: MessageCircle },
  { id: 'analysis', label: '集計', icon: BarChart3 },
  { id: 'settings', label: '設定', icon: Settings2 },
] as const;

type RoomStatusTab = 'active' | 'archived' | 'deleted';

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
  const [roomListOpen, setRoomListOpen] = useState(false);
  const [roomStatusTab, setRoomStatusTab] = useState<RoomStatusTab>('active');

  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get('view');
      setTab(navigation.some((item) => item.id === requestedTab) ? (requestedTab as AdminTab) : 'questions');
      if (params.has('event')) setEventId(params.get('event') || '');
    }
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getAdminEvents(token, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setEvents(items);
        const url = new URL(window.location.href);
        const requested = url.searchParams.get('event');
        // Pick requested if exists, otherwise first active room, otherwise first room
        const activeRooms = items.filter((item) => !item.status || item.status === 'active');
        const selected = items.some((item) => item.id === requested)
          ? requested!
          : activeRooms[0]?.id || items[0]?.id || '';
        setEventId(selected);
        if (selected) {
          url.searchParams.set('event', selected);
          window.history.replaceState(null, '', `${url.pathname}${url.search}`);
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && [401, 403].includes(e.statusCode)) onLogout();
        else setError('ルーム一覧を読み込めませんでした。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, revision, onLogout]);

  function navigate(nextTab: AdminTab, nextEvent = eventId) {
    if (nextTab === tab && nextEvent === eventId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextTab);
    if (nextEvent) url.searchParams.set('event', nextEvent);
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
    setTab(nextTab);
    setEventId(nextEvent);
  }

  function saved(item: EventItem) {
    setEvents((previous) =>
      previous.some((e) => e.id === item.id)
        ? previous.map((e) => (e.id === item.id ? item : e))
        : [item, ...previous]
    );
    setEventId(item.id);
    if (creating) {
      setCreating(false);
      navigate('questions', item.id);
    }
  }

  const activeRooms = events.filter((e) => !e.status || e.status === 'active');
  const archivedRooms = events.filter((e) => e.status === 'archived');
  const deletedRooms = events.filter((e) => e.status === 'deleted');

  function getStatusLabel(item: EventItem) {
    if (item.status === 'deleted') return 'ごみ箱';
    if (item.status === 'archived') return 'アーカイブ';
    return item.open ? '受付中' : '受付終了';
  }

  function getStatusClass(item: EventItem) {
    if (item.status === 'deleted') return 'is-deleted';
    if (item.status === 'archived') return 'is-archived';
    return item.open ? 'is-open' : '';
  }

  return (
    <main className="admin-main">
      <div className="operator-toolbar">
        <div className="operator-event-field">
          <label htmlFor="admin-event">ルーム</label>
          <select
            className="field-input"
            id="admin-event"
            value={eventId}
            disabled={!events.length}
            onChange={(e) => navigate(tab, e.target.value)}
          >
            <option value="" disabled>
              ルームを選ぶ
            </option>
            {activeRooms.length > 0 && (
              <optgroup label="通常ルーム">
                {activeRooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.open ? '' : '（受付終了）'}
                  </option>
                ))}
              </optgroup>
            )}
            {archivedRooms.length > 0 && (
              <optgroup label="アーカイブ">
                {archivedRooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}（アーカイブ）
                  </option>
                ))}
              </optgroup>
            )}
            {deletedRooms.length > 0 && (
              <optgroup label="ごみ箱">
                {deletedRooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}（ごみ箱）
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <span className={`event-status ${event ? getStatusClass(event) : ''}`}>
          {event ? getStatusLabel(event) : '未選択'}
        </span>

        <div className="operator-tools">
          <ActionButton
            tone="quiet"
            onClick={() => setRoomListOpen(true)}
            aria-label="すべてのルーム一覧を表示"
            title="ルーム一覧"
          >
            <FolderArchive size={20} />
          </ActionButton>
          <ActionButton
            tone="quiet"
            onClick={() => setShare(true)}
            disabled={!event || event.status === 'deleted'}
            aria-label="募集ページを共有"
          >
            <Share2 size={20} />
          </ActionButton>
          <ActionButton tone="quiet" onClick={() => setAccount(true)} aria-label="アカウント">
            <UserRound size={20} />
          </ActionButton>
        </div>
      </div>

      <nav className="operator-nav" aria-label="運営メニュー">
        {navigation.map(({ id, label, icon: Icon }) => (
          <ActionButton
            tone="quiet"
            key={id}
            className={tab === id ? 'is-selected' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={21} aria-hidden="true" />
            <span>{label}</span>
          </ActionButton>
        ))}
      </nav>

      {loading && (
        <p className="notice" role="status">
          ルームを読み込み中…
        </p>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
          <ActionButton tone="secondary" onClick={() => setRevision((n) => n + 1)}>
            再読み込み
          </ActionButton>
        </div>
      )}

      {event && (
        <EventWorkspace
          key={`${token}:${event.id}`}
          event={event}
          token={token}
          tab={tab}
          onSaved={saved}
          onAuthError={onLogout}
          onNavigateTab={(t) => navigate(t)}
        />
      )}

      {!loading && !error && !event && (
        <section className="surface empty-state">
          <MessageCircle size={32} />
          <h1>最初のルームを作りましょう</h1>
          <p>ルームを作成すると、質問の募集を始められます。</p>
        </section>
      )}

      {(tab === 'settings' || (!event && !loading)) && (
        <ActionButton
          className="create-event-button"
          tone="secondary"
          onClick={() => {
            setCreateRevision((v) => v + 1);
            setCreating(true);
          }}
        >
          <Plus size={19} />
          新しいルームを作る
        </ActionButton>
      )}

      {/* Account Sheet */}
      <AppSheet open={account} onOpenChange={setAccount} title="アカウント" description={`${adminUser.displayName} でログイン中`}>
        <ActionButton tone="secondary" onClick={onLogout}>
          <LogOut size={18} />
          ログアウト
        </ActionButton>
      </AppSheet>

      {/* Share Sheet */}
      <AppSheet open={share} onOpenChange={setShare} title="質問箱を共有する" description={event?.title || ''}>
        {event && <ShareControls key={event.id} eventId={event.id} title={event.title} operator />}
      </AppSheet>

      {/* Create Room Sheet */}
      <AppSheet
        open={creating}
        onOpenChange={setCreating}
        title="ルームを作る"
        description="保存すると、募集リンクを共有できます。"
      >
        <EventSettings key={createRevision} token={token} onSaved={saved} onAuthError={onLogout} />
      </AppSheet>

      {/* Room Switcher / Management Sheet */}
      <AppSheet
        open={roomListOpen}
        onOpenChange={setRoomListOpen}
        title="ルーム一覧"
        description="通常・アーカイブ・ごみ箱のルームを管理・切り替えできます。"
      >
        <div className="room-sheet-content">
          <div className="room-tabs" role="tablist" aria-label="ルーム状態切り替え">
            <button
              type="button"
              role="tab"
              aria-selected={roomStatusTab === 'active'}
              className={`room-tab-btn ${roomStatusTab === 'active' ? 'is-active' : ''}`}
              onClick={() => setRoomStatusTab('active')}
            >
              通常 ({activeRooms.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={roomStatusTab === 'archived'}
              className={`room-tab-btn ${roomStatusTab === 'archived' ? 'is-active' : ''}`}
              onClick={() => setRoomStatusTab('archived')}
            >
              アーカイブ ({archivedRooms.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={roomStatusTab === 'deleted'}
              className={`room-tab-btn ${roomStatusTab === 'deleted' ? 'is-active' : ''}`}
              onClick={() => setRoomStatusTab('deleted')}
            >
              ごみ箱 ({deletedRooms.length})
            </button>
          </div>

          <div className="room-cards-list">
            {(roomStatusTab === 'active'
              ? activeRooms
              : roomStatusTab === 'archived'
              ? archivedRooms
              : deletedRooms
            ).map((item) => (
              <div
                key={item.id}
                className={`room-item-card ${item.id === eventId ? 'is-selected' : ''}`}
              >
                <div className="room-item-header">
                  <div>
                    <h3 className="room-item-title">{item.title}</h3>
                    {item.date && <p className="muted" style={{ fontSize: '.8125rem' }}>{item.date}</p>}
                  </div>
                  <span className={`event-status ${getStatusClass(item)}`}>
                    {getStatusLabel(item)}
                  </span>
                </div>
                <div className="room-item-actions">
                  <ActionButton
                    tone={item.id === eventId ? 'primary' : 'secondary'}
                    onClick={() => {
                      navigate(tab, item.id);
                      setRoomListOpen(false);
                    }}
                  >
                    {item.id === eventId ? '選択中' : 'このルームを開く'}
                  </ActionButton>
                  {item.status !== 'deleted' && (
                    <ActionButton
                      tone="quiet"
                      onClick={() => {
                        setEventId(item.id);
                        setRoomListOpen(false);
                        setShare(true);
                      }}
                      aria-label={`${item.title}の共有を開く`}
                    >
                      <Share2 size={16} />
                      共有
                    </ActionButton>
                  )}
                </div>
              </div>
            ))}

            {roomStatusTab === 'active' && activeRooms.length === 0 && (
              <p className="muted" style={{ padding: '16px 0' }}>
                通常ルームはありません。
              </p>
            )}
            {roomStatusTab === 'archived' && archivedRooms.length === 0 && (
              <p className="muted" style={{ padding: '16px 0' }}>
                アーカイブされたルームはありません。
              </p>
            )}
            {roomStatusTab === 'deleted' && deletedRooms.length === 0 && (
              <p className="muted" style={{ padding: '16px 0' }}>
                ごみ箱は空です。
              </p>
            )}
          </div>

          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
            <ActionButton
              tone="secondary"
              className="full-width"
              onClick={() => {
                setRoomListOpen(false);
                setCreateRevision((v) => v + 1);
                setCreating(true);
              }}
            >
              <Plus size={18} />
              新しいルームを作る
            </ActionButton>
          </div>
        </div>
      </AppSheet>
    </main>
  );
}

