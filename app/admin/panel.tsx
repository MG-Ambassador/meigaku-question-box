'use client';

import { useState, useEffect } from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  getAdminEvents,
  getAdminReport,
  saveAdminEvent,
  type EventItem,
  type ReportData,
  ApiError,
} from '@/lib/api-client';
import { getRecruitmentUrl } from '@/lib/public-url';

interface PanelProps {
  token: string;
  adminUser: {
    displayName: string;
    sub: string;
    email?: string;
  };
  onLogout: () => void;
}

const emptyReport: ReportData = {
  total: 0,
  pageSize: 50,
  hasNext: false,
  generatedAt: 0,
  categories: [],
  sources: [],
  days: [],
  rows: [],
};

export default function Panel({ token, adminUser, onLogout }: PanelProps) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [report, setReport] = useState<ReportData>(emptyReport);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [accepting, setAccepting] = useState(true);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);

  const total = report.total || 0;
  const event = events.find((e) => e.id === eventId);

  async function loadEvents() {
    try {
      const data = await getAdminEvents(token);
      setEvents(data);
      setEventId((prev) => prev || data[0]?.id || '');
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403)) {
        onLogout();
        return;
      }
      setError('イベント一覧を読み込めませんでした。');
    }
  }

  useEffect(() => {
    loadEvents();
  }, [token]);

  useEffect(() => {
    if (!eventId) return;

    setReport(emptyReport);
    setError('');
    setLoading(true);

    getAdminReport(token, eventId, 50)
      .then((data) => {
        setReport(data);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403)) {
          onLogout();
          return;
        }
        setError(err instanceof Error ? err.message : '質問を読み込めませんでした。');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, eventId, revision]);

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');

    try {
      const res = await saveAdminEvent(token, {
        id: editing ? eventId : undefined,
        title,
        date,
        open: accepting,
      });

      await loadEvents();
      setEventId(res.id);
      setTitle('');
      setDate('');
      setEditing(false);
      setMsg('イベントを保存しました。');
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'イベントを保存できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!eventId) return;
    const url = getRecruitmentUrl(eventId);
    try {
      await navigator.clipboard.writeText(url);
      setMsg('募集リンクをコピーしました。');
    } catch {
      setMsg('コピーできませんでした。下の募集URLを選択してコピーしてください。');
    }
  }

  const recruitmentUrl = eventId ? getRecruitmentUrl(eventId) : '';

  return (
    <main className="admin">
      <div className="operator-account">
        <span>{adminUser.displayName} でログイン中</span>
        <nav>
          <button type="button" onClick={onLogout} className="outline text-sm">
            ログアウト
          </button>
        </nav>
      </div>

      <span className="eyebrow">EVENT INSIGHTS</span>
      <h1>イベントと集まった質問</h1>
      <p>イベントを作成して募集リンクを共有し、届いた質問を確認できます。</p>

      <nav className="admin-section-nav" aria-label="運営メニュー">
        <a href="#event-settings">イベント作成・設定</a>
        <a href="#analysis">質問の分析</a>
        <a href="#collected">質問を読む</a>
      </nav>

      {msg && <p role="status" className="status">{msg}</p>}

      <label htmlFor="admin-event">イベントを選択</label>
      <Select
        value={eventId}
        onValueChange={(v) => {
          setEventId(v);
          setEditing(false);
          setTitle('');
          setDate('');
        }}
      >
        <SelectTrigger id="admin-event">
          <SelectValue placeholder="まずはイベントを作成してください" />
        </SelectTrigger>
        <SelectContent>
          {events.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.title}（{e.open ? '受付中' : '受付終了'}）
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {event && (
        <section className="event-overview">
          <h2>{event.title}</h2>
          <p>{event.date || '開催日時・会場は未設定'}</p>
          <div className="admin-actions">
            <button
              className="outline"
              onClick={() => {
                setEditing(true);
                setTitle(event.title);
                setDate(event.date);
                setAccepting(!!event.open);
              }}
            >
              設定を編集
            </button>
            <button className="outline" onClick={copyLink}>
              募集リンクをコピー
            </button>
          </div>
          <p>会場の案内やInstagramストーリーズにこのリンクを掲載してください。</p>
          <input
            aria-label="来場者用の募集URL"
            readOnly
            value={recruitmentUrl}
          />
        </section>
      )}

      <form id="event-settings" className="event-form" onSubmit={saveEvent}>
        <h2>{editing ? 'イベントの設定' : 'イベントを作成'}</h2>
        <label>
          イベント名
          <input
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="オープンキャンパス / サタビジ！"
          />
        </label>
        <label>
          開催日時・会場（任意）
          <input
            maxLength={100}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="admin-actions">
          <Switch checked={accepting} onCheckedChange={setAccepting} />
          質問を受け付ける
        </label>
        <div className="admin-actions">
          <button className="primary" disabled={busy}>
            {busy ? '保存中…' : 'イベントを保存'}
          </button>
          {editing && (
            <button
              type="button"
              className="outline"
              onClick={() => {
                setEditing(false);
                setTitle('');
                setDate('');
                setAccepting(true);
              }}
            >
              新規作成に戻る
            </button>
          )}
        </div>
      </form>

      <section id="analysis" aria-busy={loading}>
        <h2>集まった質問を分析</h2>
        {error ? (
          <p role="alert" className="error">{error}</p>
        ) : loading ? (
          <p>読み込み中…</p>
        ) : !eventId ? (
          <p>イベントを選択すると、質問の内訳を確認できます。</p>
        ) : (
          <>
            <div className="insight-stats">
              <div>
                <span>質問の総数</span>
                <strong>
                  {total}
                  <small>件</small>
                </strong>
              </div>
              <div>
                <span>Instagramリンク経由</span>
                <strong>
                  {report.sources.find((s) => s.source === 'instagram')?.count || 0}
                  <small>件</small>
                </strong>
              </div>
              <div>
                <span>投稿されたテーマ</span>
                <strong>
                  {report.categories.length}
                  <small>種類</small>
                </strong>
              </div>
            </div>

            <p className="analysis-note">
              選択したイベントの全質問を集計。投稿者が選んだテーマ・募集リンクの経路をもとにしています。
            </p>

            <div className="insight-grid">
              <article>
                <h3>テーマ別の内訳</h3>
                {report.categories.length ? (
                  report.categories.map((c) => (
                    <div className="insight-row" key={c.category}>
                      <div>
                        <span>{c.category}</span>
                        <strong>
                          {c.count}件 · {total > 0 ? Math.round((c.count / total) * 100) : 0}%
                        </strong>
                      </div>
                      <meter
                        min={0}
                        max={total || 1}
                        value={c.count}
                        aria-label={c.category}
                      />
                    </div>
                  ))
                ) : (
                  <p>質問が届くと内訳が表示されます。</p>
                )}
              </article>

              <article>
                <h3>日別の質問数</h3>
                <p className="analysis-note">投稿があった直近30日分・日本時間</p>
                {report.days.map((d) => (
                  <div className="daily-row" key={d.day}>
                    <time>{d.day}</time>
                    <strong>{d.count}件</strong>
                  </div>
                ))}
                {!report.days.length && <p>まだ質問はありません。</p>}
              </article>
            </div>
          </>
        )}
        <button
          className="outline"
          disabled={loading || !eventId}
          onClick={() => setRevision((v) => v + 1)}
        >
          最新の質問を読み込む
        </button>
      </section>

      <section id="collected">
        <h2>収集した質問</h2>
        <p>新しい順に表示しています。質問への回答は実際のイベントで行います。</p>
        {!loading &&
          !error &&
          report.rows.map((q) => (
            <article key={q.id}>
              <div className="card-meta">
                <span>{q.category}</span>
                <time>
                  {new Date(q.created_at).toLocaleString('ja-JP', {
                    timeZone: 'Asia/Tokyo',
                  })}
                </time>
              </div>
              <h3>{q.body}</h3>
              <p className="analysis-note">
                {q.source === 'instagram' ? 'Instagramリンク経由' : 'Webから'} · 匿名
              </p>
            </article>
          ))}
        {!loading && !error && !report.rows.length && (
          <p>このイベントの質問はまだありません。</p>
        )}
      </section>
    </main>
  );
}
