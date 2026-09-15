import type {Metadata} from 'next';
import {LockKeyhole} from 'lucide-react';
export const metadata:Metadata={title:'運営管理 | 明学の質問箱',robots:{index:false,follow:false}};
export default function AdminLayout({children}:{children:React.ReactNode}){return <div className="admin-shell"><header className="operator-header"><a href="/admin" className="operator-brand">明学の質問箱 <span>運営管理</span></a><div><LockKeyhole size={16}/> 担当者専用</div></header>{children}<div className="operator-footer">MEIGAKU QUESTION BOX · 運営専用ページ</div></div>}
