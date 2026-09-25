'use client';

import { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  MessageCircle,
  ShieldCheck,
  Send,
  Plus,
  Sparkles,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { getPublicEvents, submitQuestion, ApiError, type EventItem } from '@/lib/api-client';
import { resolvePublicPath } from '@/lib/public-url';

const categories = [
  'すべて',
  '大学生活',
  '学び・授業',
  '入試・進路',
  '留学・国際交流',
  'その他',
];

export default function Home() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('大学生活');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [help, setHelp] = useState(false);

  const event = events.find((e) => e.id === eventId);

  useEffect(() => {
    getPublicEvents()
      .then((data) => {
        setEvents(data);
        const params = new URLSearchParams(window.location.search);
        const selected = params.get('event');
        setEventId(selected || data[0]?.id || '');
      })
      .catch((e) => {
        console.error('Failed to load events:', e);
      });
  }, []);

  function handleEventChange(newEventId: string) {
    setEventId(newEventId);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('event', newEventId);
      const newRelativePathQuery = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newRelativePathQuery);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const params = new URLSearchParams(window.location.search);
      const source = params.get('from') === 'instagram' ? 'instagram' : 'web';

      await submitQuestion({
        eventId,
        body,
        category,
        source,
      });

      // 投稿成功時のみ本文をクリア
      setBody('');
      setMessage('質問を受け付けました！運営担当者がイベントに向けて確認します。');
    } catch (err: unknown) {
      console.error('Submission error:', err);
      if (err instanceof ApiError) {
        if (err.statusCode === 429) {
          const retrySec = err.retryAfterSeconds || 600;
          const retryMin = Math.ceil(retrySec / 60);
          setMessage(`続けて投稿されています。約${retryMin}分ほど時間をおいてから再度お試しください。`);
        } else if (err.code === 'EVENT_CLOSED') {
          setMessage('このイベントは質問の受付を終了しています。');
        } else {
          setMessage(err.message || '送信できませんでした。時間をおいて再度お試しください。');
        }
      } else {
        setMessage('通信エラーが発生しました。ネットワーク状況を確認し、再度お試しください。');
      }
      // エラー時は body を保持する（再入力の手間を防ぐ）
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="header">
        <a className="brand" href={resolvePublicPath('/')}>
          <span className="mark">
            M<span>G</span>
          </span>
          <span>
            明治学院大学<small>MEIJI GAKUIN UNIVERSITY</small>
          </span>
        </a>
        <nav>
          <button onClick={() => setHelp(true)}>使い方</button>
          <button className="small-cta" onClick={() => setOpen(true)}>
            質問する <Plus size={17} />
          </button>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-top">
            <span className="eyebrow">来場者用 · MEIGAKU QUESTION BOX</span>
            <span className="pill">
              {event ? (event.open ? '質問募集中' : '受付終了') : 'イベント準備中'}
            </span>
          </div>

          <div className="event-picker">
            <label htmlFor="event">参加するイベント</label>
            <Select value={eventId} onValueChange={handleEventChange}>
              <SelectTrigger id="event">
                <SelectValue placeholder="イベント準備中" />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem value={e.id} key={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {event?.date && <span>{event.date}</span>}
          </div>

          <div className="hero-grid">
            <div>
              <h1>
                その「気になる」が、
                <br />
                みんなの<span className="under">きっかけに。</span>
              </h1>
              <p className="intro">
                明学のこと、大学生活のこと、これからのこと。
                <br />
                小さな疑問も、ここなら気軽に。
                <br />
                あなたの質問に、イベントでお答えします。
              </p>
              <button
                className="primary"
                onClick={() => setOpen(true)}
                disabled={!event?.open}
              >
                匿名で質問してみる <ArrowUpRight size={23} />
              </button>
              <div className="reassurance">
                <ShieldCheck size={17} /> 名前もログインも、いりません。
              </div>
            </div>

            <div className="type-art" aria-hidden="true">
              <div className="art-label">ひとつの問いから、ひろがる。</div>
              <span className="giant-q">
                Q<span>!</span>
              </span>
              <div className="art-bottom">
                <span>
                  YOUR QUESTION.
                  <br />
                  OUR NEXT CONVERSATION.
                </span>
                <Sparkles size={34} />
              </div>
            </div>
          </div>

          <div className="hero-foot">
            <span>
              <MessageCircle size={18} /> 聞いてみたい。を、聞いてみよう。
            </span>
            <span>Do for Others</span>
          </div>
        </section>

        <section className="steps">
          <div>
            <span>01</span>
            <p>
              <strong>まずは、気軽に投稿</strong>
              <small>名前を出さずに、あなたの言葉で。</small>
            </p>
          </div>
          <div>
            <span>02</span>
            <p>
              <strong>運営が内容を確認</strong>
              <small>安心して参加できる場にするために。</small>
            </p>
          </div>
          <div>
            <span>03</span>
            <p>
              <strong>イベントで、一緒に知る</strong>
              <small>集まった質問をもとにお答えします。</small>
            </p>
          </div>
        </section>

        <section className="safety">
          <ShieldCheck size={25} />
          <div>
            <h3>安心して、質問できる場所に。</h3>
            <p>
              名前・メールアドレスの入力は不要です。投稿は運営担当者がイベントに向けて確認します。
              <br />
              氏名や連絡先など、あなたや誰かの個人情報は書かないでください。
            </p>
            <button onClick={() => setHelp(true)}>
              ご利用にあたって <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-brand">
          明学の質問箱 <small>MEIGAKU QUESTION BOX</small>
        </div>
        <span>ひとつの問いが、誰かのために。</span>
      </footer>

      {/* 質問投稿ダイアログ */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="form-dialog">
          <DialogHeader>
            <span className="eyebrow">YOUR QUESTION</span>
            <DialogTitle className="dialog-title">聞いてみよう。</DialogTitle>
            <DialogDescription>
              {event
                ? `${event.title} への質問です。運営担当者だけが閲覧します。`
                : 'イベント準備中です。受付開始までお待ちください。'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit}>
            <label htmlFor="category">質問のテーマ</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.slice(1).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label htmlFor="question">聞いてみたいこと</label>
            <textarea
              id="question"
              required
              minLength={1}
              maxLength={500}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="例えば、入学前にやっておいてよかったことは？"
            />
            <div className="form-note">
              <span>個人情報を書かないでください。</span>
              <span>{body.length} / 500</span>
            </div>

            <p className="consent">
              送信すると、運営担当者による閲覧・集計とイベントでの紹介に同意したものとします。すべての質問に回答できるとは限りません。
            </p>

            <button
              className="primary full"
              disabled={busy || body.trim().length < 1 || !event?.open}
            >
              {busy ? '送信中…' : '匿名で質問を送る'}
              <Send size={18} />
            </button>

            {message && (
              <p role="status" className="status">
                {message}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>

      {/* 使い方・規約ダイアログ */}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ご利用にあたって</DialogTitle>
            <DialogDescription>気持ちよく参加できる質問箱にするために。</DialogDescription>
          </DialogHeader>
          <div className="help">
            <h3>投稿者について</h3>
            <p>
              名前やメールアドレスは収集しません。不正な連続投稿の対策として、一時的な通信識別情報を利用します。ホスティング事業者のアクセスログには通信情報が残る場合があります。
            </p>
            <h3>質問の閲覧・回答について</h3>
            <p>
              質問の本文は運営担当者だけが閲覧します。集まった質問はイベントの準備と分析に使用し、当日のトークで紹介・回答する場合があります。
            </p>
            <h3>Instagramからの参加</h3>
            <p>
              ストーリーズに掲載されたリンクから、このフォームへ質問を送れます。このフォームではInstagramのアカウント名も入力不要です。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
