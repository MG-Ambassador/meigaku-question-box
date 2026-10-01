'use client';

import { useState } from 'react';
import {
  BarChart3,
  MessageCircle,
  RotateCcw,
  Settings2,
  Star,
} from 'lucide-react';
import { ActionButton } from '@/components/question-box/action-button';
import { AppSheet } from '@/components/question-box/app-sheet';
import { ConfirmDialog } from '@/components/question-box/confirm-dialog';
import { ShareControls } from '@/components/question-box/share-controls';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CATEGORIES } from '@/lib/question-draft';

/**
 * 開発時専用: 13種類の基本コンポーネント状態プレビューギャラリー
 * 通常・選択・待機・無効・エラー・長文の状態を確認可能。適用外と実画面での確認は状態仕様書に記載。
 */
export function ComponentGallery() {
  const [filter, setFilter] = useState('大学生活');
  const [nav, setNav] = useState('質問');
  const [switchChecked, setSwitchChecked] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>(CATEGORIES[0]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [favoriteActive, setFavoriteActive] = useState(true);
  const [undoActive, setUndoActive] = useState(true);

  return (
    <div className="dev-gallery" style={{ padding: '24px', maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>開発用UI部品ギャラリー（13種類・状態一覧）</h1>
        <p className="muted">デザイン4原則（Straight, Minimal, Contrast, Playful）と状態（通常・選択・待機・無効・エラー・長文）の検証用</p>
      </header>

      {/* 1. ActionButton */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>1. ボタン（ActionButton）</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <ActionButton tone="primary">Primary 通常</ActionButton>
          <ActionButton tone="primary" busy>Primary 待機中</ActionButton>
          <ActionButton tone="primary" disabled>Primary 無効</ActionButton>
          <ActionButton tone="secondary">Secondary 通常</ActionButton>
          <ActionButton tone="secondary" busy>Secondary 待機中</ActionButton>
          <ActionButton tone="secondary" disabled>Secondary 無効</ActionButton>
          <ActionButton tone="quiet">Quiet 通常</ActionButton>
          <ActionButton tone="quiet" busy>処理中…</ActionButton>
          <ActionButton tone="quiet" disabled>Quiet 無効</ActionButton>
          <ActionButton tone="danger">Danger 通常</ActionButton>
          <ActionButton tone="danger" busy>処理中…</ActionButton>
          <ActionButton tone="danger" disabled>Danger 無効</ActionButton>
          <ActionButton tone="primary">長い案内文でも操作内容が省略されずに読み取れるボタンの表示例</ActionButton>
        </div>
      </section>

      {/* 2. 入力欄 */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>2. 入力欄（Textarea / Input）</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label className="field-label">
            通常入力
            <input className="field-input" placeholder="通常の入力欄" defaultValue="明学のオープンキャンパスについて" />
          </label>
          <label className="field-label">
            エラー状態（aria-invalid）
            <input className="field-input" aria-invalid="true" aria-describedby="dev-name-error" defaultValue="" placeholder="必須項目です" />
            <span id="dev-name-error" className="notice notice-error" style={{ marginTop: '4px' }}>ルーム名を入力してください。</span>
          </label>
          <label className="field-label">
            読取専用（未確認送信時 readOnly）
            <textarea
              className="question-input"
              readOnly
              rows={3}
              defaultValue="前回の未確認質問です。テキストを選択・コピーできますが、編集は保護されています。"
            />
          </label>
          <label className="field-label">
            無効状態（disabled）
            <input className="field-input" disabled defaultValue="無効化された入力欄" />
          </label>
          <label className="field-label">
            長文入力（500文字上限検証）
            <textarea
              className="question-input"
              rows={3}
              defaultValue={'あ'.repeat(480) + '…残り20文字'}
            />
          </label>
        </div>
      </section>

      {/* 3. テーマ選択 */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>3. テーマ選択（RadioGroup）</h2>
        <RadioGroup value={selectedCategory} onValueChange={setSelectedCategory} className="theme-options">
          {CATEGORIES.map((cat, i) => (
            <label className="theme-option" key={cat}>
              <RadioGroupItem value={cat} id={`dev-theme-${i}`} className="theme-radio" />
              <span>{cat}</span>
            </label>
          ))}
        </RadioGroup>
        <RadioGroup disabled defaultValue={CATEGORIES[0]} aria-label="操作できないテーマの表示例" className="theme-options">
          <label className="theme-option"><RadioGroupItem value={CATEGORIES[0]} /><span>{CATEGORIES[0]}（処理中）</span></label>
        </RadioGroup>
      </section>

      {/* 4. 絞り込みバー・チップ */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>4. 絞り込みバー（FilterBar / Chips）</h2>
        <RadioGroup className="filter-chips" aria-label="テーマで絞り込み" value={filter} onValueChange={setFilter} onKeyDown={(e) => {
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
          e.preventDefault();
          const options = ['すべて', ...CATEGORIES];
          const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
          const next = (options.indexOf(filter) + delta + options.length) % options.length;
          setFilter(options[next]);
          document.getElementById(`dev-filter-${next}`)?.focus();
        }}>
          {['すべて', ...CATEGORIES].map((cat, i) => (
            <label key={cat} className={`theme-option ${filter === cat ? 'is-active' : ''}`}>
              <RadioGroupItem id={`dev-filter-${i}`} value={cat} /><span>{cat}</span>
            </label>
          ))}
        </RadioGroup>
        <div className="filter-indicator" role="status">
          <span>条件適用中: [テーマ: {filter}] · 42件</span>
          <ActionButton tone="quiet" onClick={() => setFilter('すべて')} aria-label="条件を解除"><RotateCcw size={16} /> 解除</ActionButton>
        </div>
      </section>

      {/* 5. スイッチ */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>5. 受付スイッチ（Switch）</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label className="accepting-control" htmlFor="dev-switch-1">
            <span>
              <strong>質問を受け付ける（ON）</strong>
              <small>トラック枠幅48px、thumb22px、枠内収容・均等2px余白確認</small>
            </span>
            <Switch
              id="dev-switch-1"
              className="accepting-switch"
              checked={switchChecked}
              onCheckedChange={setSwitchChecked}
            />
          </label>
          <label className="accepting-control" htmlFor="dev-switch-2">
            <span>
              <strong>質問を受け付ける（OFF・無効）</strong>
              <small>受付終了表示</small>
            </span>
            <Switch id="dev-switch-2" className="accepting-switch" checked={false} disabled />
          </label>
        </div>
      </section>

      {/* 6. ナビゲーション */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>6. ナビゲーション（OperatorNav）</h2>
        <nav className="operator-nav" aria-label="運営メニューサンプル">
          <ActionButton tone="quiet" className={nav === '質問' ? 'is-selected' : ''} aria-current={nav === '質問' ? 'page' : undefined} onClick={() => setNav('質問')}>
            <MessageCircle size={21} /> <span>質問</span>
          </ActionButton>
          <ActionButton tone="quiet" className={nav === '集計' ? 'is-selected' : ''} aria-current={nav === '集計' ? 'page' : undefined} onClick={() => setNav('集計')}>
            <BarChart3 size={21} /> <span>集計</span>
          </ActionButton>
          <ActionButton tone="quiet" className={nav === '設定' ? 'is-selected' : ''} aria-current={nav === '設定' ? 'page' : undefined} onClick={() => setNav('設定')}>
            <Settings2 size={21} /> <span>設定</span>
          </ActionButton>
        </nav>
      </section>

      {/* 7. 質問カード */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>7. 質問カード（QuestionRow）</h2>
        <article className="question-row" data-category="大学生活">
          <div className="question-meta">
            <span className="theme-badge" data-category="大学生活">大学生活</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <time>10月1日 15:30</time>
              <button
                type="button"
                className="star-button"
                aria-pressed={favoriteActive}
                onClick={() => setFavoriteActive(!favoriteActive)}
                aria-label="お気に入り"
              >
                <Star size={20} strokeWidth={favoriteActive ? 0 : 2} fill={favoriteActive ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
          <p className="question-body">サークルの雰囲気や活動日数はどのくらいですか？兼サーしている先輩はいますか？</p>
          <p className="question-source">Instagramリンク経由 · 匿名</p>
        </article>

        {/* 長文カード */}
        <article className="question-row" data-category="入試・進路">
          <div className="question-meta">
            <span className="theme-badge" data-category="入試・進路">入試・進路</span>
            <time>10月1日 14:10</time>
          </div>
          <p className="question-body">
            {'国際学部の就職先について詳しく知りたいです。留学経験を活かしたキャリアに進む人が多いと聞きましたが、具体的にどのような業界や職種に就職されているのでしょうか？インターンシップの準備や就活支援サポートについても教えていただけると助かります。'.repeat(2)}
          </p>
          <p className="question-source">Webから · 匿名</p>
        </article>
      </section>

      {/* 8. お気に入り & 取消通知 */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>8. お気に入り解除時インライン取消（Inline Undo）</h2>
        <article className={`question-row ${undoActive ? 'is-unfavorited' : ''}`} data-category="入試・進路">
          {undoActive && (
            <div className="undo-inline-notice" role="status">
              <span>自分のお気に入りを解除しました（次回の更新で一覧から除外されます）</span>
              <ActionButton tone="quiet" onClick={() => setUndoActive(false)}>元に戻す</ActionButton>
            </div>
          )}
          <div className="question-meta">
            <span className="theme-badge" data-category="入試・進路">入試・進路</span>
            <time>10月1日 12:00</time>
          </div>
          <p className="question-body">総合型選抜の出願準備で気をつけるべきポイントは？</p>
          <p className="question-source">Webから · 匿名</p>
        </article>
      </section>

      {/* 9. 集計項目 */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>9. 集計項目カード・行（Insight Card & Row）</h2>
        <div className="stat-grid">
          <button type="button" className="insight-card-button">
            <span>届いた質問</span>
            <strong>150<small>件</small></strong>
            <span className="insight-card-action">全質問を見る →</span>
          </button>
          <button type="button" className="insight-card-button">
            <span>Instagramリンク経由</span>
            <strong>48<small>件</small></strong>
            <span className="insight-card-action">該当質問を見る →</span>
          </button>
        </div>
        <button type="button" className="insight-row-button">
          <div style={{ width: '100%' }}>
            <div className="category-stat" data-category="大学生活" style={{ marginTop: 0 }}>
              <div>
                <span style={{ fontWeight: 700 }}>大学生活</span>
                <strong>60件 <small>40%</small></strong>
              </div>
              <meter min={0} max={150} value={60} aria-hidden="true" />
            </div>
          </div>
          <span className="insight-row-action">質問を見る →</span>
        </button>
      </section>

      {/* 10. 通知・空状態 */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>10. 通知・空状態（Notice & Empty State）</h2>
        <p className="notice" role="status">通常通知: 自動更新中 · 最終確認 15:40:00</p>
        <p className="notice" role="status" aria-busy="true">読み込み中…</p>
        <p className="notice" role="status">長い案内文の表示例：{'入力内容は残っています。通信状況を確認してからもう一度お試しください。'.repeat(3)}</p>
        <div className="notice notice-error" role="alert">
          <p>エラー通知: 通信に失敗しました。取得済みの質問はそのまま読めます。</p>
          <ActionButton tone="secondary">再試行</ActionButton>
        </div>
        <div className="empty-state surface">
          <MessageCircle size={30} />
          <h2>該当する質問がありません</h2>
          <p>条件に一致する質問が見つかりませんでした。</p>
        </div>
      </section>

      {/* 11. シート */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>11. シート（AppSheet）</h2>
        <ActionButton tone="secondary" onClick={() => setSheetOpen(true)}>
          シートを開くプレビュー（200msアニメーション確認）
        </ActionButton>
        <AppSheet open={sheetOpen} onOpenChange={setSheetOpen} title="テスト用シート" description="Escapeキー、背景クリック、閉じるボタンで閉じます">
          <div style={{ padding: '16px 0' }}>
            <p>シート内部コンテンツ。スクロールやフォーカストラップの動作を検証します。</p>
            <ActionButton tone="primary" onClick={() => setSheetOpen(false)}>閉じる</ActionButton>
          </div>
        </AppSheet>
      </section>

      {/* 12. 確認ダイアログ */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>12. 確認ダイアログ（ConfirmDialog）</h2>
        <ActionButton tone="danger" onClick={() => setDialogOpen(true)}>
          確認ダイアログを開く
        </ActionButton>
        <ConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="質問の受付を終了しますか？"
          description="受付を終了すると、新しい質問の投稿が停止します。"
          action="受付を終了して保存"
          actionTone="primary"
          onConfirm={() => setDialogOpen(false)}
          cancelText="キャンセル"
        />
      </section>

      {/* 13. 共有コントロール */}
      <section className="surface" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2>13. 共有コントロール（ShareControls）</h2>
        <ShareControls eventId="sample-room" title="オープンキャンパス質問箱" operator />
      </section>
    </div>
  );
}
