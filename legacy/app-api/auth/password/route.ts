import {authDb,authLimit} from '@/lib/auth-db';
import {json,payload} from '@/lib/server';
import {operator,loginId,passwordValid,initializeOperator,verifyPassword,hashPassword,issueSession,logout} from '@/lib/password-auth';
export async function POST(r:Request){try{const p=await payload(r);if(!p||typeof p!=='object')return json({error:'入力を確認してください。'},400);
 if(p.action==='logout'){await logout();return json({ok:true})}
 const ip=r.headers.get('cf-connecting-ip');if(!ip)return json({error:'現在ログインを利用できません。'},503);
 await authLimit('password-ip',ip,600,30);
 if(p.action==='login'){
  const id=loginId(p.loginId);if(!id||typeof p.password!=='string'||p.password.length>128)return json({error:'運営IDまたはパスワードが正しくありません。'},401);
  await authLimit('password-id',id,900,10);
  if(id==='mga-owner')await initializeOperator();
  const row=await authDb().prepare('SELECT id,password_hash,version,active FROM operators WHERE login_id=?').bind(id).first<{id:string;password_hash:string;version:number;active:number}>();
  const valid=verifyPassword(p.password,row?.password_hash||'');if(!valid||!row?.active)return json({error:'運営IDまたはパスワードが正しくありません。'},401);
  await issueSession(row.id,row.version);return json({ok:true})
 }
 if(p.action==='change'){
  const u=await operator();if(!u)return json({error:'もう一度ログインしてください。'},401);
  await authLimit('password-change',u.userId,900,10);
  if(typeof p.currentPassword!=='string'||p.currentPassword.length>128||!passwordValid(p.password)||p.currentPassword===p.password)return json({error:'新しいパスワードは現在と異なる15〜128文字で入力してください。'},400);
  const row=await authDb().prepare('SELECT password_hash FROM operators WHERE id=? AND version=? AND active=1').bind(u.userId,u.version).first<{password_hash:string}>();
  if(!row||!verifyPassword(p.currentPassword,row.password_hash))return json({error:'現在のパスワードが正しくありません。'},400);
  const hash=hashPassword(p.password);const result=await authDb().batch([
   authDb().prepare('UPDATE operators SET password_hash=?,must_change=0,version=version+1 WHERE id=? AND version=? AND active=1').bind(hash,u.userId,u.version),
   authDb().prepare('DELETE FROM operator_sessions WHERE operator_id=?').bind(u.userId)
  ]);if(!result[0].meta.changes)return json({error:'アカウントが更新されました。ログインし直してください。'},409);
  await issueSession(u.userId,u.version+1);return json({ok:true})
 }
 return json({error:'入力を確認してください。'},400)
 }catch(e){const kind=(e as Error).message;if(kind==='AUTH_RATE_LIMIT')return json({error:'試行回数が多いため、15分ほど待ってからお試しください。'},429);if(kind==='ORIGIN'||kind==='INPUT')return json({error:'このページから操作してください。'},400);return json({error:'処理できませんでした。時間をおいて再度お試しください。'},503)}}
