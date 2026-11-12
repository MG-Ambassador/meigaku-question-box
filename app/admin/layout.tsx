import type { Metadata } from 'next';
import { LockKeyhole } from 'lucide-react';
import { resolvePublicPath } from '@/lib/public-url';

export const metadata: Metadata = {
  title: '運営管理 | 明学の質問箱',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <header className="operator-header">
        <a href={resolvePublicPath('/admin/')} className="operator-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- Static export serves the official SVG as-is. */}
          <img src={resolvePublicPath('/brand/mg-symbol.svg')} alt="" width={30} height={24} />
          明学の質問箱 <span>運営管理</span>
        </a>
        <div>
          <LockKeyhole size={16} /> 担当者専用
        </div>
      </header>
      {children}
      <div className="operator-footer">MEIJI GAKUIN UNIVERSITY · 質問箱 運営専用ページ</div>
    </div>
  );
}
