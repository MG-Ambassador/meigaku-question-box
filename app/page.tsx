'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, HelpCircle, LockKeyhole, MessageCircle } from 'lucide-react';
import { ApiError, getPublicEvent, type EventItem } from '@/lib/api-client';
import { resolvePublicPath } from '@/lib/public-url';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { QuestionForm } from '@/components/question-box/question-form';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [event, setEvent] = useState<EventItem | null>(null);
  const [booted, setBooted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [noRoom, setNoRoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    function readLocation() {
      setBusy(false);
      setEvent(null);
      setNotFound(false);
      setError('');
      setAmbiguous(false);
      setNoRoom(false);

      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      const eventParam = params.get('event');

      // Ambiguous link check
      if (roomParam && eventParam && roomParam !== eventParam) {
        setAmbiguous(true);
        setRoomId('');
        setLoading(false);
        return;
      }

      // Legacy ?event=<id> backwards compatibility redirect to canonical ?room=<id>
      if (!roomParam && eventParam) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', eventParam);
        url.searchParams.delete('event');
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
        setRoomId(eventParam);
        setLoading(true);
        return;
      }

      if (roomParam) {
        setRoomId(roomParam);
        setLoading(true);
      } else {
        setRoomId('');
        setNoRoom(true);
        setLoading(false);
      }
    }

    readLocation();
    setBooted(true);
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);

  const poll = useForegroundPoll(
    async (signal) => {
      if (!roomId) return;
      try {
        const result = await getPublicEvent(roomId, signal);
        if (!signal.aborted) {
          setEvent(result);
          setNotFound(false);
          setError('');
          setLoading(false);
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof ApiError && e.statusCode === 404) {
          setNotFound(true);
          setEvent(null);
          setError('この質問箱は利用できないか、終了しました。主催者から案内されたリンクをご確認ください。');
        } else {
          setError('ルーム情報を読み込めませんでした。通信状況を確認して、もう一度お試しください。');
        }
        setLoading(false);
        throw e;
      }
    },
    30000,
    booted && !busy && !!roomId,
    roomId
  );

  return (
    <div className="visitor-shell">
      <a href="#main-content" className="skip-link">
        質問入力へ移動
      </a>
      <header className="visitor-header">
        <a href={resolvePublicPath('/')} className="wordmark" aria-label="明学の質問箱 ホーム">
          <span className="brand-symbol" aria-hidden="true">
            m<span>g</span>.
          </span>
          <span>
            明学の質問箱<small>MEIJI GAKUIN UNIVERSITY</small>
          </span>
        </a>
        <ActionButton tone="quiet" className="help-button" onClick={() => setHelp(true)}>
          <HelpCircle size={18} aria-hidden="true" />使い方
        </ActionButton>
      </header>

      <main id="main-content" className="visitor-main">
        <div className="visitor-caption">
          <span className="eyebrow">MEIGAKU QUESTION BOX</span>
          <span className="caption-line" />
        </div>

        {event && (
          <section className="event-context" aria-label="質問するルーム">
            <div>
              <p className="eyebrow">参加するルーム</p>
              <h2>{event.title}</h2>
              {event.date && <p className="muted">{event.date}</p>}
            </div>
            <div className="event-context-actions">
              <span className={`event-status ${event.open ? 'is-open' : ''}`}>
                {event.open ? '受付中' : '受付終了'}
              </span>
            </div>
          </section>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            <p>{error}</p>
            {!notFound && (
              <ActionButton tone="secondary" onClick={poll.refresh}>
                もう一度読み込む
              </ActionButton>
            )}
          </div>
        )}

        {poll.paused && (
          <p className="notice" role="status">
            接続を待っています。接続が戻るとルーム情報を確認します。
          </p>
        )}

        {loading && !event && (
          <div className="form-loading" role="status">
            <div className="skeleton-line" />
            <div className="skeleton-input" />
            <p>ルームを読み込み中…</p>
          </div>
        )}

        {ambiguous && (
          <section className="surface empty-state" aria-label="曖昧なリンク">
            <AlertCircle size={32} />
            <h1>リンクを確認してください</h1>
            <p className="muted">
              指定されたリンクに複数のルーム情報が含まれています。主催者から案内されたリンクをご確認ください。
            </p>
          </section>
        )}

        {noRoom && (
          <section className="surface empty-state" aria-label="ルーム案内">
            <MessageCircle size={32} />
            <h1>主催者から案内されたリンクを開いてください</h1>
            <p className="muted">
              質問を募集しているルームごとに専用のURLまたはQRコードが用意されています。主催者からの案内に従ってアクセスしてください。
            </p>
          </section>
        )}

        {notFound && (
          <section className="surface empty-state" aria-label="利用不可">
            <LockKeyhole size={32} />
            <h1>この質問箱は利用できません</h1>
            <p className="muted">
              指定されたルームは終了したか、削除された可能性があります。主催者から案内されたリンクをご確認ください。
            </p>
          </section>
        )}

        {event && (
          <QuestionForm
            key={event.id}
            event={event}
            onBusyChange={setBusy}
            onClosed={() => {
              setEvent((current) => (current ? { ...current, open: 0 } : current));
              poll.refresh();
            }}
          />
        )}
      </main>

      <footer className="visitor-footer">
        <span>ひとつの問いが、誰かのために。</span>
        <span>Do for Others</span>
      </footer>

      <AppSheet
        open={help}
        onOpenChange={setHelp}
        title="気軽に、安心して質問するために"
        description="名前もログインもいりません。質問への回答はイベントで行います。"
      >
        <div className="help-copy">
          <h3>質問の送り方</h3>
          <p>
            参加するルームを確認し、聞いてみたいこととテーマを入力します。「紙飛行機にする」を押して折り畳んだら、上へスワイプするか「タップして送信」で送信してください。
          </p>
          <h3>質問を見られる人</h3>
          <p>
            本文は運営担当者だけが閲覧し、イベントの準備と集計に使用します。当日のトークで紹介・回答する場合があります。すべての質問への回答はお約束できません。
          </p>
          <h3>個人情報について</h3>
          <p>
            氏名・メールアドレスは入力不要です。あなたや誰かの氏名・連絡先を本文に書かないでください。連投対策に一時的な通信識別情報を使用し、ホスティング事業者のアクセスログに通信情報が残る場合があります。
          </p>
          <h3>下書きについて</h3>
          <p>
            このタブの下書きは原則2時間保持し、送信完了時に削除します。タブを閉じると復元できない場合があります。送信結果が分からないときは、同じ内容で再確認できます。
          </p>
          <h3>Instagramからの参加</h3>
          <p>Instagramのアカウント名も入力不要です。募集リンクからそのまま質問できます。</p>
        </div>
      </AppSheet>
    </div>
  );
}

