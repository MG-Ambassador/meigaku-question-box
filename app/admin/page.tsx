import {operator} from '@/lib/password-auth';
import Panel from './panel';
import PasswordLogin,{PasswordLogout} from './password-login';
export const dynamic='force-dynamic';
export default async function Page(){let u;try{u=await operator()}catch{return <main className="operator-entry"><h1>運営画面に接続できません</h1><p>時間をおいてページを読み込み直してください。</p><a href="/admin">もう一度読み込む</a></main>}
 if(!u)return <PasswordLogin/>;if(u.mustChange)return <PasswordLogin change required/>;return <><div className="operator-account"><span>{u.displayName}（{u.loginId}）</span><nav>{u.role==='owner'&&<a href="/admin/operators">担当者の管理</a>}<a href="/admin/password">パスワード変更</a><PasswordLogout/></nav></div><Panel/></>}
