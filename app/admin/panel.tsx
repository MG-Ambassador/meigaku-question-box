'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  FolderArchive,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Plus,
  Settings2,
  Share2,
  UserRound,
} from 'lucide-react';
import { getAdminEvents, ApiError, type EventItem } from '@/lib/api-client';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { ConfirmDialog } from '@/components/question-box/confirm-dialog';
import { ShareControls } from '@/components/question-box/share-controls';
import { EventSettings } from '@/components/question-box/event-settings';
import { EventWorkspace, type AdminTab } from '@/components/question-box/event-workspace';
import { ADMIN_HISTORY_CHANGE, historyIndex, initializeAdminHistory, writeAdminHistory } from '@/lib/admin-history';
import { ComponentGallery } from '@/components/dev/component-gallery';

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
  const [createDirty, setCreateDirty] = useState(false);
  const [confirmDiscardCreate, setConfirmDiscardCreate] = useState(false);
  const [createdNoticeEvent, setCreatedNoticeEvent] = useState<EventItem | null>(null);
  const [account, setAccount] = useState(false);
  const [shareTargetEvent, setShareTargetEvent] = useState<EventItem | null>(null);
  const [roomListOpen, setRoomListOpen] = useState(false);
  const [roomStatusTab, setRoomStatusTab] = useState<RoomStatusTab>('active');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ tab: AdminTab; eventId: string; historyDelta?: number } | null>(null);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [pendingCreateRoom, setPendingCreateRoom] = useState(false);
  const [devGalleryOpen, setDevGalleryOpen] = useState(false);
  const saving = useRef(false);
  const createSaving = useRef(false);
  const acceptedIndex = useRef(0);
  const restoringHistory = useRef(false);
  const allowTraversal = useRef(false);
  const blockedScroll = useRef(0);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const discardRef = useRef<(() => void) | null>(null);

  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    function restore(e: PopStateEvent) {
      if (restoringHistory.current) {
        e.stopImmediatePropagation();
        const delta = historyIndex() - acceptedIndex.current;
        if (delta) window.history.go(-delta);
        else {
          restoringHistory.current = false;
          requestAnimationFrame(() => window.scrollTo({ top: blockedScroll.current, behavior: 'instant' }));
        }
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get('view');
      const nextTab = navigation.some((item) => item.id === requestedTab) ? (requestedTab as AdminTab) : 'questions';
      const nextEvent = params.get('event') || eventId;
      const delta = historyIndex() - acceptedIndex.current;
      if (!allowTraversal.current && (saving.current || createSaving.current || (tab === 'settings' && settingsDirty &&
          (nextTab !== 'settings' || nextEvent !== eventId)))) {
        // Traverse back to the original entry; pushState would destroy Forward history.
        e.stopImmediatePropagation();
        if (delta) {
          blockedScroll.current = window.scrollY;
          restoringHistory.current = true;
          window.history.go(-delta);
          if (!saving.current && !createSaving.current) setPendingNav({ tab: nextTab, eventId: nextEvent, historyDelta: delta });
        }
        return;
      }
      allowTraversal.current = false;
      acceptedIndex.current = historyIndex();
      setTab(nextTab);
      if (params.has('event')) setEventId(params.get('event') || '');
    }

    window.addEventListener('popstate', restore, true);
    return () => window.removeEventListener('popstate', restore, true);
  }, [tab, settingsDirty, eventId]);

  useEffect(() => {
    initializeAdminHistory();
    acceptedIndex.current = historyIndex();
    const track = () => { acceptedIndex.current = historyIndex(); };
    window.addEventListener(ADMIN_HISTORY_CHANGE, track);
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('view');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize from browser URL after hydration; subsequent updates subscribe to popstate.
    setTab(navigation.some((item) => item.id === requestedTab) ? (requestedTab as AdminTab) : 'questions');
    if (params.has('event')) setEventId(params.get('event') || '');
    return () => window.removeEventListener(ADMIN_HISTORY_CHANGE, track);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset request UI when the authenticated session or room-list revision changes.
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
          writeAdminHistory(`${url.pathname}${url.search}`, true);
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

  function executeNav(nextTab: AdminTab, nextEvent = eventId) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextTab);
    if (nextEvent) url.searchParams.set('event', nextEvent);
    writeAdminHistory(`${url.pathname}${url.search}`);
    setTab(nextTab);
    setEventId(nextEvent);
  }

  function navigate(nextTab: AdminTab, nextEvent = eventId, skipHistory = false) {
    if (saving.current) return;
    if (nextTab === tab && nextEvent === eventId) return;
    if (tab === 'settings' && settingsDirty) {
      setPendingNav({ tab: nextTab, eventId: nextEvent });
      return;
    }
    if (skipHistory) {
      setTab(nextTab);
      setEventId(nextEvent);
    } else {
      executeNav(nextTab, nextEvent);
    }
  }

  function finishNavigation(dest: { tab: AdminTab; eventId: string; historyDelta?: number }) {
    if (dest.historyDelta) {
      allowTraversal.current = true;
      window.history.go(dest.historyDelta);
    } else executeNav(dest.tab, dest.eventId);
  }

  async function handleSaveAndNavigate() {
    if (!pendingNav) return;
    const dest = pendingNav;
    setPendingNav(null);
    const saveFn = saveRef.current;
    if (saveFn) {
      const ok = await saveFn();
      if (ok) {
        setSettingsDirty(false);
        finishNavigation(dest);
      }
    } else {
      finishNavigation(dest);
    }
  }

  function handleDiscardAndNavigate() {
    if (!pendingNav) return;
    discardRef.current?.();
    setSettingsDirty(false);
    const dest = pendingNav;
    setPendingNav(null);
    finishNavigation(dest);
  }

  function openCreateRoom() {
    if (saving.current) return;
    if (tab === 'settings' && settingsDirty) {
      setPendingCreateRoom(true);
      return;
    }
    setCreateDirty(false);
    setCreateRevision((v) => v + 1);
    setCreating(true);
  }

  function handleLogoutClick() {
    if (saving.current) return;
    setAccount(false);
    if (tab === 'settings' && settingsDirty) {
      setPendingLogout(true);
    } else {
      onLogout();
    }
  }

  function saved(item: EventItem) {
    setSettingsDirty(false);
    setEvents((previous) =>
      previous.some((e) => e.id === item.id)
        ? previous.map((e) => (e.id === item.id ? item : e))
        : [item, ...previous]
    );
    setEventId(item.id);
    if (creating) {
      setCreating(false);
      setCreateDirty(false);
      navigate('questions', item.id);
      setCreatedNoticeEvent(item);
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
            onClick={() => setShareTargetEvent(event || null)}
            disabled={!event || event.status === 'deleted'}
            aria-label="募集ページを共有"
          >
            <Share2 size={20} />
          </ActionButton>
          <ActionButton tone="quiet" onClick={() => setAccount(true)} aria-label="アカウント">
            <UserRound size={20} />
          </ActionButton>
          {process.env.NODE_ENV !== 'production' && (
            <ActionButton
              tone="quiet"
              onClick={() => setDevGalleryOpen(true)}
              aria-label="UI部品ギャラリー（開発専用）"
              title="UI部品ギャラリー"
            >
              <LayoutGrid size={20} />
            </ActionButton>
          )}
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

      {createdNoticeEvent && (
        <div
          className="surface created-room-banner"
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
            margin: '0 0 16px',
            padding: '12px 16px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--secondary)',
          }}
        >
          <div>
            <strong>ルーム「{createdNoticeEvent.title}」を作成しました</strong>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '.875rem' }}>
              募集リンクを共有して、質問を集めましょう。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <ActionButton
              tone="primary"
              onClick={() => setShareTargetEvent(createdNoticeEvent)}
            >
              <Share2 size={16} /> 募集リンクを共有
            </ActionButton>
            <ActionButton
              tone="quiet"
              onClick={() => setCreatedNoticeEvent(null)}
              aria-label="案内を閉じる"
            >
              閉じる
            </ActionButton>
          </div>
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
          onNavigateTab={(t, skipHistory) => navigate(t, eventId, skipHistory)}
          onDirtyChange={setSettingsDirty}
          onBusyChange={(busy) => { saving.current = busy; }}
          saveRef={saveRef}
          discardRef={discardRef}
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
          onClick={openCreateRoom}
        >
          <Plus size={19} />
          新しいルームを作る
        </ActionButton>
      )}

      {/* Account Sheet */}
      <AppSheet open={account} onOpenChange={setAccount} title="アカウント" description={`${adminUser.displayName} でログイン中`}>
        <ActionButton tone="secondary" onClick={handleLogoutClick}>
          <LogOut size={18} />
          ログアウト
        </ActionButton>
      </AppSheet>

      {/* Share Sheet */}
      <AppSheet
        open={!!shareTargetEvent}
        onOpenChange={(open) => {
          if (!open) setShareTargetEvent(null);
        }}
        title="質問箱を共有する"
        description={shareTargetEvent?.title || ''}
      >
        {shareTargetEvent && (
          <ShareControls
            key={shareTargetEvent.id}
            eventId={shareTargetEvent.id}
            title={shareTargetEvent.title}
            operator
          />
        )}
      </AppSheet>

      {/* Create Room Sheet */}
      <AppSheet
        open={creating}
        onOpenChange={(open) => {
          if (!open) {
            if (createSaving.current) return;
            if (createDirty) {
              setConfirmDiscardCreate(true);
            } else {
              setCreating(false);
            }
          }
        }}
        title="ルームを作る"
        description="保存すると、募集リンクを共有できます。"
      >
        <EventSettings
          key={createRevision}
          token={token}
          onSaved={saved}
          onAuthError={onLogout}
          onDirtyChange={setCreateDirty}
          onBusyChange={(busy) => { createSaving.current = busy; }}
        />
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
                        setShareTargetEvent(item);
                        setRoomListOpen(false);
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
                openCreateRoom();
              }}
            >
              <Plus size={18} />
              新しいルームを作る
            </ActionButton>
          </div>
        </div>
      </AppSheet>

      {/* Unsaved Settings Confirmation Dialog for Navigation */}
      <ConfirmDialog
        open={!!pendingNav}
        onOpenChange={(open) => {
          if (!open) setPendingNav(null);
        }}
        title="未保存の変更があります"
        description="ルーム設定の編集内容が保存されていません。保存して移動しますか、それとも破棄して移動しますか？"
        action="保存して移動"
        actionTone="primary"
        onConfirm={() => void handleSaveAndNavigate()}
        secondaryAction="破棄して移動"
        onSecondaryAction={handleDiscardAndNavigate}
        cancelText="移動をキャンセル"
      />

      {/* Unsaved Confirmation for Discarding Room Creation */}
      <ConfirmDialog
        open={confirmDiscardCreate}
        onOpenChange={setConfirmDiscardCreate}
        title="未保存の変更があります"
        description="新しいルームの入力内容が破棄されます。よろしいですか？"
        action="破棄して閉じる"
        actionTone="danger"
        onConfirm={() => {
          if (createSaving.current) return;
          setConfirmDiscardCreate(false);
          setCreateDirty(false);
          setCreating(false);
        }}
        cancelText="入力を続ける"
      />

      {/* Unsaved Settings Confirmation Dialog for Logout */}
      <ConfirmDialog
        open={pendingLogout}
        onOpenChange={(open) => {
          if (!open) setPendingLogout(false);
        }}
        title="未保存の変更があります"
        description="ルーム設定の編集内容が保存されていません。保存してログアウトしますか、それとも破棄してログアウトしますか？"
        action="保存してログアウト"
        actionTone="primary"
        onConfirm={async () => {
          setPendingLogout(false);
          const saveFn = saveRef.current;
          if (saveFn) {
            const ok = await saveFn();
            if (ok) {
              setSettingsDirty(false);
              onLogout();
            }
          } else {
            onLogout();
          }
        }}
        secondaryAction="破棄してログアウト"
        onSecondaryAction={() => {
          setPendingLogout(false);
          discardRef.current?.();
          setSettingsDirty(false);
          onLogout();
        }}
        cancelText="ログアウトをキャンセル"
      />

      {/* Unsaved Settings Confirmation Dialog for Create Room */}
      <ConfirmDialog
        open={pendingCreateRoom}
        onOpenChange={(open) => {
          if (!open) setPendingCreateRoom(false);
        }}
        title="未保存の変更があります"
        description="ルーム設定の編集内容が保存されていません。保存して新しいルームを作成しますか、それとも破棄して作成しますか？"
        action="保存して作成"
        actionTone="primary"
        onConfirm={async () => {
          setPendingCreateRoom(false);
          const saveFn = saveRef.current;
          if (saveFn) {
            const ok = await saveFn();
            if (ok) {
              setSettingsDirty(false);
              setCreateDirty(false);
              setCreateRevision((v) => v + 1);
              setCreating(true);
            }
          }
        }}
        secondaryAction="破棄して作成"
        onSecondaryAction={() => {
          setPendingCreateRoom(false);
          discardRef.current?.();
          setSettingsDirty(false);
          setCreateDirty(false);
          setCreateRevision((v) => v + 1);
          setCreating(true);
        }}
        cancelText="作成をキャンセル"
      />

      {/* Dev-only Component Gallery Sheet */}
      {process.env.NODE_ENV !== 'production' && (
        <AppSheet
          open={devGalleryOpen}
          onOpenChange={setDevGalleryOpen}
          title="UI部品ギャラリー（開発専用）"
          description="13種類の基本コンポーネント全状態の確認画面"
        >
          <ComponentGallery />
        </AppSheet>
      )}
    </main>
  );
}

