'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, QrCode, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getRecruitmentUrl } from '@/lib/public-url';
import { ActionButton } from './action-button';
import { AppSheet } from './app-sheet';

export function ShareControls({ eventId, title, operator = false }: { eventId: string; title: string; operator?: boolean }) {
  const [source, setSource] = useState<'web' | 'instagram'>('web');
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState(false);
  const [qr, setQr] = useState(false);
  const sharing = useRef(false);
  const url = getRecruitmentUrl(eventId, source);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true); setMessage('リンクをコピーしました。');
      clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2500);
    } catch { setFallback(true); setMessage('下のURLを選択してコピーしてください。'); }
  }
  async function share() {
    if (sharing.current) return;
    const data = { title: `${title} | 明学の質問箱`, text: 'イベントで聞いてみたいことを、匿名で質問できます。', url };
    if (!navigator.share || (navigator.canShare && !navigator.canShare(data))) { await copy(); return; }
    sharing.current = true;
    try { await navigator.share(data); }
    catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setFallback(true); setMessage('共有を開けませんでした。リンクをコピーして共有できます。');
      }
    } finally { sharing.current = false; }
  }
  return <div className="share-controls">
    {operator && <label className="field-label">リンクの用途
      <select
        className="field-input"
        value={source}
        onChange={(e) => {
          setSource(e.target.value as typeof source);
          setMessage('');
          setCopied(false);
          setFallback(false);
        }}
      >
        <option value="web">通常の共有・会場QR</option><option value="instagram">Instagram掲載用</option>
      </select>
    </label>}
    <div className="button-row">
      <ActionButton type="button" tone="secondary" onClick={share}><Share2 size={18} aria-hidden="true" />{operator ? '募集ページを共有' : 'この質問箱を共有'}</ActionButton>
      <ActionButton type="button" tone="quiet" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'コピーしました' : 'リンクをコピー'}</ActionButton>
      {operator && <ActionButton type="button" tone="quiet" onClick={() => setQr(true)}><QrCode size={18} />QRを表示</ActionButton>}
    </div>
    <p className="share-status muted" role="status">{message}</p>
    {(operator || fallback) && <label className="field-label">募集ページのURL<input className="field-input share-url" readOnly value={url} onFocus={(e) => e.target.select()} /></label>}
    <AppSheet open={qr} onOpenChange={setQr} title="質問箱のQRコード" description={title}>
      <div className="qr-display"><QRCodeSVG value={url} size={256} level="M" marginSize={4} title={`${title} の募集ページ`} /><p>カメラで読み取ると、質問できます。</p><p className="muted">{source === 'instagram' ? 'Instagram掲載用' : '通常の共有・会場用'}</p></div>
    </AppSheet>
  </div>;
}
