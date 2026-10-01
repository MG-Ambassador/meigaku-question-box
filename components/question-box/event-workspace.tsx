'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import {
  ApiError,
  getAdminReport,
  toggleAdminQuestionFavorite,
  type EventItem,
  type QuestionRow,
  type ReportData,
} from '@/lib/api-client';
import { appendReport, newQuestionCount } from '@/lib/report-state';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { CATEGORIES } from '@/lib/question-draft';
import { ActionButton } from './action-button';
import { AppSheet } from './app-sheet';
import { writeAdminHistory } from '@/lib/admin-history';
import { EventSettings } from './event-settings';

export type AdminTab = 'questions' | 'analysis' | 'settings';
const time = (value: number) =>
  new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function EventWorkspace({
  event,
  token,
  tab,
  onSaved,
  onAuthError,
  onNavigateTab,
  onDirtyChange,
  onBusyChange,
  saveRef,
  discardRef,
}: {
  event: EventItem;
  token: string;
  tab: AdminTab;
  onSaved: (event: EventItem) => void;
  onAuthError: () => void;
  onNavigateTab?: (tab: AdminTab, skipHistory?: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  saveRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  discardRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [report, setReport] = useState<ReportData | null>(null);
  const snapshot = useRef<ReportData | null>(null);
  const [latest, setLatest] = useState<ReportData | null>(null);
  const [lastSuccess, setLastSuccess] = useState(0);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null);

  // Filters & Sorting state
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'theme'>('newest');
  const [favorite, setFavorite] = useState<'all' | 'favorite'>('all');
  const [day, setDay] = useState('');
  const [source, setSource] = useState('');
  const [fromInsights, setFromInsights] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // Mobile filter draft state
  const [draftFavorite, setDraftFavorite] = useState<'all' | 'favorite'>('all');
  const [draftSort, setDraftSort] = useState<'newest' | 'oldest' | 'theme'>('newest');

  function openFilterSheet() {
    setDraftFavorite(favorite);
    setDraftSort(sort);
    setFilterSheetOpen(true);
  }

  // Favorites tracking
  const pendingFavorites = useRef<Set<string>>(new Set());
  const insightsScrollY = useRef(0);

  const manual = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);

  const chipsList = ['', ...CATEGORIES];
  function handleThemeKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (index + 1) % chipsList.length;
      const nextCat = chipsList[nextIdx];
      setCategory(nextCat);
      updateQueryUrl({ category: nextCat });
      requestAnimationFrame(() => {
        document.getElementById(`filter-chip-${nextIdx}`)?.focus();
      });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (index - 1 + chipsList.length) % chipsList.length;
      const prevCat = chipsList[prevIdx];
      setCategory(prevCat);
      updateQueryUrl({ category: prevCat });
      requestAnimationFrame(() => {
        document.getElementById(`filter-chip-${prevIdx}`)?.focus();
      });
    }
  }

  // Read URL query parameters on mount & history navigation
  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('category') || '';
      const s = (params.get('sort') as 'newest' | 'oldest' | 'theme') || 'newest';
      const fav = (params.get('favorite') as 'all' | 'favorite') || 'all';
      const d = params.get('day') || '';
      const src = params.get('source') || '';
      const fi = params.get('from_insights') === '1';

      setCategory(cat);
      setSort(['newest', 'oldest', 'theme'].includes(s) ? s : 'newest');
      setFavorite(fav === 'favorite' ? 'favorite' : 'all');
      setDay(d);
      setSource(src);
      setFromInsights(fi);

      const requestedTab = params.get('view');
      if (requestedTab === 'analysis' && insightsScrollY.current > 0) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: insightsScrollY.current, behavior: 'instant' });
        });
      }
    }
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      manual.current?.abort();
      generation.current += 1;
    };
  }, []);

  function updateQueryUrl(updates: {
    category?: string;
    sort?: 'newest' | 'oldest' | 'theme';
    favorite?: 'all' | 'favorite';
    day?: string;
    source?: string;
    from_insights?: boolean;
  }) {
    const url = new URL(window.location.href);
    const newCat = updates.category !== undefined ? updates.category : category;
    const newSort = updates.sort !== undefined ? updates.sort : sort;
    const newFav = updates.favorite !== undefined ? updates.favorite : favorite;
    const newDay = updates.day !== undefined ? updates.day : day;
    const newSrc = updates.source !== undefined ? updates.source : source;
    const newFi = updates.from_insights !== undefined ? updates.from_insights : fromInsights;

    if (newCat) url.searchParams.set('category', newCat);
    else url.searchParams.delete('category');

    if (newSort && newSort !== 'newest') url.searchParams.set('sort', newSort);
    else url.searchParams.delete('sort');

    if (newFav && newFav !== 'all') url.searchParams.set('favorite', newFav);
    else url.searchParams.delete('favorite');

    if (newDay) url.searchParams.set('day', newDay);
    else url.searchParams.delete('day');

    if (newSrc) url.searchParams.set('source', newSrc);
    else url.searchParams.delete('source');

    if (newFi) url.searchParams.set('from_insights', '1');
    else url.searchParams.delete('from_insights');

    writeAdminHistory(`${url.pathname}${url.search}`);
  }

  // Poll for background updates
  const poll = useForegroundPoll(
    async (signal) => {
      if (manual.current) return;
      const version = generation.current;
      try {
        const result = await getAdminReport(
          token,
          event.id,
          {
            pageSize: snapshot.current ? 1 : 50,
            category: category || undefined,
            sort,
            favorite: favorite === 'favorite' ? 'favorite' : undefined,
            day: day || undefined,
            source: (source as 'web' | 'instagram') || undefined,
          },
          null,
          signal
        );
        if (signal.aborted || version !== generation.current) return;
        if (!snapshot.current) {
          snapshot.current = result;
          setReport(result);
        }
        setLatest(result);
        setLastSuccess(Date.now());
        setError('');
      } catch (e) {
        if (signal.aborted || version !== generation.current) return;
        if (e instanceof ApiError && [401, 403].includes(e.statusCode)) {
          onAuthError();
          return;
        }
        setError('更新できていません。取得済みの質問はそのまま読めます。');
        throw e;
      }
    },
    tab === 'analysis' ? 15000 : 3000,
    tab !== 'settings',
    `${event.id}:${token}:${category}:${sort}:${favorite}:${day}:${source}`
  );

  const load = useCallback(
    async (mode: 'refresh' | 'more', focusHeading = false) => {
      if (manual.current) {
        if (mode === 'more') return;
        // refresh時は進行中のリクエストを明示的にキャンセルして中断
        manual.current.abort();
        manual.current = null;
      }
      if (mode === 'more' && !snapshot.current?.nextCursor) return;

      const controller = new AbortController();
      manual.current = controller;
      const requestGen = ++generation.current;
      setBusy(mode);
      setPageError('');

      try {
        const result = await getAdminReport(
          token,
          event.id,
          {
            pageSize: 50,
            cursor: mode === 'more' ? snapshot.current?.nextCursor : null,
            category: category || undefined,
            sort,
            favorite: favorite === 'favorite' ? 'favorite' : undefined,
            day: day || undefined,
            source: (source as 'web' | 'instagram') || undefined,
          },
          null,
          controller.signal
        );
        if (controller.signal.aborted || !alive.current || requestGen !== generation.current) return;
        const next = mode === 'more' && snapshot.current ? appendReport(snapshot.current, result) : result;
        snapshot.current = next;
        setReport(next);
        setError('');
        setLastSuccess(Date.now());
        if (mode === 'refresh') {
          setLatest(result);
          setExpired(false);
          if (focusHeading) {
            requestAnimationFrame(() => {
              heading.current?.focus();
              heading.current?.scrollIntoView({ block: 'start' });
            });
          }
        }
      } catch (e) {
        if (controller.signal.aborted || !alive.current || requestGen !== generation.current) return;
        if (e instanceof ApiError && [401, 403].includes(e.statusCode)) {
          onAuthError();
          return;
        }
        if (e instanceof ApiError && ['CURSOR_EXPIRED', 'INVALID_CURSOR'].includes(e.code)) {
          setExpired(true);
          setPageError('一覧の取得期限が切れました。読んでいる質問を残しています。一覧を更新すると続きを取得できます。');
        } else {
          setPageError('読み込めませんでした。通信状況を確認して、もう一度お試しください。');
        }
      } finally {
        if (manual.current === controller) manual.current = null;
        if (alive.current && requestGen === generation.current) setBusy(null);
      }
    },
    [token, event.id, category, sort, favorite, day, source, onAuthError]
  );

  // Trigger reload when filter conditions change
  useEffect(() => {
    if (manual.current) {
      manual.current.abort();
      manual.current = null;
    }
    generation.current += 1;
    snapshot.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalidate the old external API snapshot before loading new filter results.
    setReport(null);
    setLatest(null);
    void load('refresh');
  }, [load]);

  async function handleToggleFavorite(q: QuestionRow) {
    if (pendingFavorites.current.has(q.id)) return;
    pendingFavorites.current.add(q.id);
    const nextVal = !q.isFavorite;

    // Optimistic UI update
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => (row.id === q.id ? { ...row, isFavorite: nextVal } : row)),
      };
    });

    if (snapshot.current) {
      snapshot.current = {
        ...snapshot.current,
        rows: snapshot.current.rows.map((row) => (row.id === q.id ? { ...row, isFavorite: nextVal } : row)),
      };
    }

    try {
      await toggleAdminQuestionFavorite(token, q.id, nextVal);
    } catch {
      // Rollback
      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) => (row.id === q.id ? { ...row, isFavorite: !nextVal } : row)),
        };
      });
      if (snapshot.current) {
        snapshot.current = {
          ...snapshot.current,
          rows: snapshot.current.rows.map((row) => (row.id === q.id ? { ...row, isFavorite: !nextVal } : row)),
        };
      }
      setPageError('お気に入りの更新に失敗しました。');
    } finally {
      pendingFavorites.current.delete(q.id);
    }
  }

  function clearAllFilters(writeHistory = true) {
    setCategory('');
    setSort('newest');
    setFavorite('all');
    setDay('');
    setSource('');
    setFromInsights(false);
    if (writeHistory) updateQueryUrl({ category: '', sort: 'newest', favorite: 'all', day: '', source: '', from_insights: false });
  }

  function filterFromInsight(newFilters: { category?: string; day?: string; source?: string }) {
    insightsScrollY.current = window.scrollY;
    setCategory(newFilters.category || '');
    setDay(newFilters.day || '');
    setSource(newFilters.source || '');
    setFavorite('all');
    setSort('newest');
    setFromInsights(true);

    const url = new URL(window.location.href);
    url.searchParams.set('view', 'questions');
    if (newFilters.category) url.searchParams.set('category', newFilters.category);
    else url.searchParams.delete('category');
    if (newFilters.day) url.searchParams.set('day', newFilters.day);
    else url.searchParams.delete('day');
    if (newFilters.source) url.searchParams.set('source', newFilters.source);
    else url.searchParams.delete('source');
    url.searchParams.delete('favorite');
    url.searchParams.delete('sort');
    url.searchParams.set('from_insights', '1');
    writeAdminHistory(`${url.pathname}${url.search}`);

    if (onNavigateTab) onNavigateTab('questions', true);
    requestAnimationFrame(() => {
      heading.current?.focus();
    });
  }

  function returnToInsights() {
    setFromInsights(false);
    clearAllFilters(false);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'analysis');
    url.searchParams.delete('favorite');
    url.searchParams.delete('sort');
    url.searchParams.delete('category');
    url.searchParams.delete('day');
    url.searchParams.delete('source');
    url.searchParams.delete('from_insights');
    writeAdminHistory(`${url.pathname}${url.search}`);
    if (onNavigateTab) onNavigateTab('analysis', true);
    requestAnimationFrame(() => {
      window.scrollTo({ top: insightsScrollY.current, behavior: 'instant' });
    });
  }

  const favoritesChanged = favorite === 'favorite' && report && latest && report.favoriteRevision !== latest.favoriteRevision;
  const newCount = favorite !== 'favorite' && report && latest ? newQuestionCount(report, latest) : 0;
  const data = latest || report;
  const hasActiveFilter = !!category || sort !== 'newest' || favorite !== 'all' || !!day || !!source;

  // Grouping for theme sort mode
  const renderedRows = report?.rows || [];
  const themeGrouped =
    sort === 'theme'
      ? CATEGORIES.map((cat) => ({
          category: cat,
          rows: renderedRows.filter((r) => r.category === cat),
        })).filter((group) => group.rows.length > 0)
      : null;

  function renderQuestionCard(q: QuestionRow) {
    const isUndoState = favorite === 'favorite' && !q.isFavorite;
    return (
      <article
        className={`question-row ${isUndoState ? 'is-unfavorited' : ''}`}
        key={q.id}
        data-category={q.category}
      >
        {isUndoState && (
          <div className="undo-inline-notice" role="status">
            <span>自分のお気に入りを解除しました（次回の更新で一覧から除外されます）</span>
            <ActionButton tone="quiet" onClick={() => void handleToggleFavorite(q)}>
              元に戻す
            </ActionButton>
          </div>
        )}
        <div className="question-meta">
          <span className="theme-badge" data-category={q.category}>
            {q.category}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <time dateTime={new Date(q.created_at).toISOString()}>
              {new Date(q.created_at).toLocaleString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Tokyo',
              })}
            </time>
            <button
              type="button"
              className="star-button"
              aria-pressed={q.isFavorite}
              aria-label={q.isFavorite ? '自分のお気に入りから解除' : '自分のお気に入りに追加'}
              onClick={() => void handleToggleFavorite(q)}
            >
              <Star
                size={20}
                strokeWidth={q.isFavorite ? 0 : 2}
                fill={q.isFavorite ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        <p className="question-body">{q.body}</p>
        <p className="question-source">{q.source === 'instagram' ? 'Instagramリンク経由' : 'Webから'} · 匿名</p>
      </article>
    );
  }

  return (
    <div>
      <section hidden={tab !== 'questions'} aria-label="質問一覧" className="questions-workspace">
        {fromInsights && (
          <div style={{ marginBottom: '16px' }}>
            <ActionButton tone="secondary" onClick={returnToInsights}>
              <ArrowLeft size={17} /> 集計に戻る
            </ActionButton>
          </div>
        )}

        <div className="workspace-heading">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              届いた質問 <span className="count-tag">{report?.filteredTotal ?? report?.total ?? '—'}</span>
            </h1>
          </div>
          <ActionButton tone="quiet" disabled={!!busy} onClick={() => void load('refresh', true)} aria-label="一覧を更新">
            <RefreshCw size={19} />
          </ActionButton>
        </div>

        <p className="update-status" role="status">
          {poll.paused ? '自動更新を一時停止中' : error ? '更新できていません' : '自動更新'}
          {lastSuccess > 0 && ` · 最終確認 ${time(lastSuccess)}`}
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
            <ActionButton tone="quiet" onClick={poll.refresh}>
              再試行
            </ActionButton>
          </p>
        )}

        {/* Filter Bar */}
        <div className="filter-bar" aria-label="絞り込みと並び替え">
          <div className="filter-chips" role="radiogroup" aria-label="テーマで絞り込み">
            {chipsList.map((cat, idx) => {
              const isSelected = category === cat;
              return (
                <button
                  key={cat || 'all'}
                  id={`filter-chip-${idx}`}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={`filter-chip ${isSelected ? 'is-active' : ''}`}
                  onClick={() => {
                    setCategory(cat);
                    updateQueryUrl({ category: cat });
                  }}
                  onKeyDown={(e) => handleThemeKeyDown(e, idx)}
                >
                  {cat || 'すべて'}
                </button>
              );
            })}
          </div>

          {/* Mobile Sheet Trigger */}
          <div className="filter-controls-row mobile-only">
            <ActionButton
              type="button"
              tone="secondary"
              className="mobile-filter-trigger"
              onClick={openFilterSheet}
              aria-label="絞り込み・並び順"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>絞り込み・並び順</span>
              {(favorite === 'favorite' || sort !== 'newest') && (
                <span className="filter-badge">
                  {(favorite === 'favorite' ? 1 : 0) + (sort !== 'newest' ? 1 : 0)}
                </span>
              )}
            </ActionButton>

            {hasActiveFilter && (
              <ActionButton tone="quiet" onClick={() => clearAllFilters()} aria-label="絞り込み条件をリセット">
                <RotateCcw size={16} /> 条件を解除
              </ActionButton>
            )}
          </div>

          {/* Desktop Controls Row */}
          <div className="filter-controls-row desktop-only">
            <div className="filter-select-group">
              <label htmlFor="filter-view-select" className="sr-only">
                表示条件
              </label>
              <select
                id="filter-view-select"
                className="filter-select"
                value={favorite}
                onChange={(e) => {
                  const val = e.target.value as 'all' | 'favorite';
                  setFavorite(val);
                  updateQueryUrl({ favorite: val });
                }}
              >
                <option value="all">すべて表示</option>
                <option value="favorite">★ 自分のお気に入り</option>
              </select>

              <label htmlFor="filter-sort-select" className="sr-only">
                並び順
              </label>
              <select
                id="filter-sort-select"
                className="filter-select"
                value={sort}
                onChange={(e) => {
                  const val = e.target.value as 'newest' | 'oldest' | 'theme';
                  setSort(val);
                  updateQueryUrl({ sort: val });
                }}
              >
                <option value="newest">新しい順</option>
                <option value="oldest">古い順</option>
                <option value="theme">テーマ順</option>
              </select>
            </div>

            {hasActiveFilter && (
              <ActionButton tone="quiet" onClick={() => clearAllFilters()} aria-label="絞り込み条件をリセット">
                <RotateCcw size={16} /> 条件を解除
              </ActionButton>
            )}
          </div>
        </div>

        {/* Mobile Filter Sheet */}
        <AppSheet
          open={filterSheetOpen}
          onOpenChange={(open) => {
            if (!open) {
              setDraftFavorite(favorite);
              setDraftSort(sort);
            }
            setFilterSheetOpen(open);
          }}
          title="絞り込み・並び順"
          description="お気に入りや並び順を設定します。"
        >
          <div className="filter-sheet-body">
            <div className="field-group">
              <label htmlFor="mobile-filter-view-select" className="field-label">
                表示条件
              </label>
              <select
                id="mobile-filter-view-select"
                className="field-input"
                value={draftFavorite}
                onChange={(e) => setDraftFavorite(e.target.value as 'all' | 'favorite')}
              >
                <option value="all">すべて表示</option>
                <option value="favorite">★ 自分のお気に入り</option>
              </select>
            </div>

            <div className="field-group" style={{ marginTop: '16px' }}>
              <label htmlFor="mobile-filter-sort-select" className="field-label">
                並び順
              </label>
              <select
                id="mobile-filter-sort-select"
                className="field-input"
                value={draftSort}
                onChange={(e) => setDraftSort(e.target.value as 'newest' | 'oldest' | 'theme')}
              >
                <option value="newest">新しい順</option>
                <option value="oldest">古い順</option>
                <option value="theme">テーマ順</option>
              </select>
            </div>

            <div className="button-row" style={{ marginTop: '24px', justifyContent: 'space-between' }}>
              {hasActiveFilter && (
                <ActionButton
                  type="button"
                  tone="quiet"
                  onClick={() => {
                    clearAllFilters();
                    setDraftFavorite('all');
                    setDraftSort('newest');
                    setFilterSheetOpen(false);
                  }}
                >
                  条件を解除
                </ActionButton>
              )}
              <ActionButton
                type="button"
                tone="primary"
                className={hasActiveFilter ? '' : 'full-width'}
                onClick={() => {
                  setFavorite(draftFavorite);
                  setSort(draftSort);
                  updateQueryUrl({ favorite: draftFavorite, sort: draftSort });
                  setFilterSheetOpen(false);
                }}
              >
                完了
              </ActionButton>
            </div>
          </div>
        </AppSheet>

        {hasActiveFilter && (
          <div className="filter-indicator" role="status">
            <span>
              条件適用中:
              {category && ` [テーマ: ${category}]`}
              {favorite === 'favorite' && ' [自分のお気に入り]'}
              {sort !== 'newest' && ` [並び順: ${sort === 'oldest' ? '古い順' : 'テーマ順'}]`}
              {day && ` [日付: ${day}]`}
              {source && ` [流入元: ${source === 'instagram' ? 'Instagram' : 'Web'}]`}
              {report && ` · ${report.filteredTotal ?? report.rows.length}件`}
            </span>
            <ActionButton tone="quiet" onClick={() => clearAllFilters()} aria-label="条件を解除">
              <X size={16} /> 解除
            </ActionButton>
          </div>
        )}

        <div className="new-questions-slot" aria-live="polite" aria-atomic="true">
          {favoritesChanged || newCount > 0 ? (
            <ActionButton
              className="new-questions-button"
              busy={busy === 'refresh'}
              disabled={!!busy}
              onClick={() => void load('refresh', true)}
            >
              <ArrowUp size={17} />
              {favoritesChanged ? 'お気に入りが変更されました · 一覧を更新' : `新しい質問が${newCount}件 · 表示する`}
            </ActionButton>
          ) : (
            <span className="muted">
              {sort === 'oldest' ? '古い順に表示中' : sort === 'theme' ? 'テーマ順に表示中' : '新しい順に表示中'}
            </span>
          )}
        </div>

        {!report && !error && (
          <div className="surface form-loading" role="status">
            <div className="skeleton-line" />
            <div className="skeleton-input" />
            <p>質問を読み込み中…</p>
          </div>
        )}

        {report && !report.rows.length && (
          <div className="empty-state surface">
            <MessageCircle size={30} />
            <h2>{hasActiveFilter ? '該当する質問がありません' : '最初の質問を待っています'}</h2>
            <p>
              {hasActiveFilter
                ? '条件に一致する質問が見つかりませんでした。条件を変更するか解除してください。'
                : '届いた質問はここに表示されます。'}
            </p>
            {hasActiveFilter && (
              <div style={{ marginTop: '16px' }}>
                <ActionButton tone="secondary" onClick={() => clearAllFilters()}>
                  条件を解除して全件を見る
                </ActionButton>
              </div>
            )}
          </div>
        )}

        {/* Question List */}
        {sort === 'theme' && themeGrouped ? (
          <div>
            {themeGrouped.map((group) => (
              <div key={group.category}>
                <div className="theme-group-header">
                  <h2>{group.category}</h2>
                  <span className="count-tag">{group.rows.length}件</span>
                </div>
                <div className="question-list">
                  {group.rows.map((q) => renderQuestionCard(q))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="question-list">
            {report?.rows.map((q) => renderQuestionCard(q))}
          </div>
        )}

        {pageError && (
          <p className="notice notice-error" role="alert">
            {pageError}
          </p>
        )}

        <div className="pagination-area">
          {expired ? (
            <ActionButton tone="secondary" busy={busy === 'refresh'} onClick={() => void load('refresh', true)}>
              一覧を更新
            </ActionButton>
          ) : (
            report?.hasNext && (
              <ActionButton
                tone="secondary"
                className="full-width"
                busy={busy === 'more'}
                disabled={!!busy}
                onClick={() => void load('more')}
              >
                {busy === 'more' ? '読み込み中…' : 'さらに読み込む'}
              </ActionButton>
            )
          )}
          {report && (
            <p className="muted" role="status">
              {report.rows.length} / {report.filteredTotal ?? report.total}件
              {report.generatedAt ? ` · ${time(report.generatedAt)}時点` : ''}
            </p>
          )}
        </div>
      </section>

      {/* Analysis Workspace with click-through navigation */}
      <section hidden={tab !== 'analysis'} className="analysis-workspace" aria-label="質問の集計">
        <div className="workspace-heading">
          <div>
            <h1>質問の集計</h1>
          </div>
          <ActionButton tone="quiet" disabled={!!busy} onClick={poll.refresh} aria-label="集計を更新">
            <RefreshCw size={19} />
          </ActionButton>
        </div>

        <p className="update-status" role="status">
          {error ? '更新できていません' : poll.paused ? '自動更新を一時停止中' : '15秒ごとに更新'}
          {data && ` · ${time(data.generatedAt)}時点`}
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        {!data ? (
          <p role="status">集計を読み込み中…</p>
        ) : (
          <>
            <div className="stat-grid">
              <button
                type="button"
                className="insight-card-button"
                onClick={() => filterFromInsight({})}
                aria-label={`届いた質問全 ${data.total} 件の本文を見る`}
              >
                <span>届いた質問</span>
                <strong>
                  {data.total}
                  <small>件</small>
                </strong>
                <span className="insight-card-action">全質問を見る →</span>
              </button>

              <button
                type="button"
                className="insight-card-button"
                onClick={() => filterFromInsight({ source: 'instagram' })}
                aria-label={`Instagramリンク経由 ${data.sources.find((s) => s.source === 'instagram')?.count || 0} 件の本文を見る`}
              >
                <span>Instagramリンク経由</span>
                <strong>
                  {data.sources.find((s) => s.source === 'instagram')?.count || 0}
                  <small>件</small>
                </strong>
                <span className="insight-card-action">該当質問を見る →</span>
              </button>

              <div className="insight-stat-card">
                <span>質問のテーマ</span>
                <strong>
                  {data.categories.length}
                  <small>種類</small>
                </strong>
              </div>
            </div>

            <div className="analysis-grid">
              <section className="surface">
                <h2>テーマ別</h2>
                <p className="muted" style={{ fontSize: '.8125rem', marginBottom: '12px' }}>
                  項目を選択すると該当テーマの質問へ進みます
                </p>
                {data.categories.map((c) => (
                  <button
                    key={c.category}
                    type="button"
                    className="insight-row-button"
                    onClick={() => filterFromInsight({ category: c.category })}
                    aria-label={`${c.category} ${c.count}件の質問を見る`}
                  >
                    <div style={{ width: '100%' }}>
                      <div className="category-stat" data-category={c.category} style={{ marginTop: 0 }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{c.category}</span>
                          <strong>
                            {c.count}件 <small>{Math.round((c.count / (data.total || 1)) * 100)}%</small>
                          </strong>
                        </div>
                        <meter min={0} max={data.total || 1} value={c.count} aria-hidden="true" />
                      </div>
                    </div>
                    <span className="insight-row-action">
                      質問を見る
                      <ChevronRight size={18} aria-hidden="true" />
                    </span>
                  </button>
                ))}
                {!data.categories.length && <p className="muted">質問が届くと内訳が表示されます。</p>}
              </section>

              <section className="surface">
                <h2>日別</h2>
                <p className="muted" style={{ fontSize: '.8125rem', marginBottom: '12px' }}>
                  日付を選択するとその日の質問へ進みます · 日本時間
                </p>
                {data.days.map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    className="insight-row-button"
                    onClick={() => filterFromInsight({ day: d.day })}
                    aria-label={`${d.day} ${d.count}件の質問を見る`}
                  >
                    <div className="daily-stat" style={{ width: '100%', borderBottom: 0, padding: 0 }}>
                      <time dateTime={d.day}>{d.day}</time>
                      <strong>{d.count}件</strong>
                    </div>
                    <span className="insight-row-action">
                      質問を見る
                      <ChevronRight size={18} aria-hidden="true" />
                    </span>
                  </button>
                ))}
                {!data.days.length && <p className="muted">まだ質問はありません。</p>}
              </section>
            </div>
            <p className="muted">流入元は募集リンクに基づく集計です。実際に使用したアプリを特定するものではありません。</p>
          </>
        )}
      </section>

      <section hidden={tab !== 'settings'} aria-label="ルーム設定">
        <EventSettings
          event={event}
          token={token}
          onSaved={onSaved}
          onAuthError={onAuthError}
          onDirtyChange={onDirtyChange}
          onBusyChange={onBusyChange}
          saveRef={saveRef}
          discardRef={discardRef}
        />
      </section>
    </div>
  );
}
