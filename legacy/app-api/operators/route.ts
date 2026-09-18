import {admin,json,payload} from '@/lib/server';
import {authDb,randomSecret,authLimit} from '@/lib/auth-db';
import {loginId,hashPassword} from '@/lib/password-auth';
export async function GET(){try{const u=await admin();if(u?.role!=='owner')return json({error:'運営責任者だけが利用できます。'},403);return json((await authDb().prepare('SELECT id,login_id,display_name,role,active,must_change FROM operators ORDER BY created_at').all()).results)}catch{return json({error:'担当者を読み込めませんでした。'},503)}}
export async function POST(r:Request){try{const u=await admin();if(u?.role!=='owner')return json({error:'運営責任者だけが利用できます。'},403);const p=await payload(r);await authLimit('operator-manage',u.userId,600,30);
 if(p.action==='create'){
  const id=loginId(p.loginId),name=typeof p.name==='string'?p.name.trim():'';if(!id||!name||name.length>60)return json({error:'運営IDは半角英数字・ハイフン・アンダーバー3〜40文字、表示名は60文字以内で入力してください。'},400);
  const existing=await authDb().prepare('SELECT id FROM operators WHERE login_id=?').bind(id).first();if(existing)return json({error:'この運営IDは使用されています。'},409);
  const temporaryPassword=randomSecret().slice(0,24),hash=hashPassword(temporaryPassword),key=crypto.randomUUID();
  await authDb().batch([authDb().prepare("INSERT INTO operators(id,login_id,display_name,password_hash,role,active,must_change,version,created_at) VALUES(?,?,?,?,'operator',1,1,1,?)").bind(key,id,name,hash,Date.now()),authDb().prepare('INSERT INTO audit(id,actor,action,question_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),u.userId,'operator-create',key,Date.now())]);return json({loginId:id,temporaryPassword})
 }
 if(typeof p.id!=='string'||p.id===u.userId)return json({error:'自分自身の利用停止・再発行はできません。パスワード変更をご利用ください。'},400);
 const target=await authDb().prepare("SELECT login_id FROM operators WHERE id=? AND role='operator'").bind(p.id).first<{login_id:string}>();if(!target)return json({error:'担当者が見つかりません。'},404);
 let temporaryPassword:string|undefined;let stmt;
 if(p.action==='reset'){temporaryPassword=randomSecret().slice(0,24);stmt=authDb().prepare('UPDATE operators SET password_hash=?,must_change=1,version=version+1 WHERE id=?').bind(hashPassword(temporaryPassword),p.id)}
 else if(p.action==='disable'||p.action==='enable'){stmt=authDb().prepare('UPDATE operators SET active=?,version=version+1 WHERE id=?').bind(p.action==='enable'?1:0,p.id)}
 else return json({error:'操作を確認してください。'},400);
 await authDb().batch([stmt,authDb().prepare('DELETE FROM operator_sessions WHERE operator_id=?').bind(p.id),authDb().prepare('INSERT INTO audit(id,actor,action,question_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),u.userId,'operator-'+p.action,p.id,Date.now())]);return json({ok:true,loginId:target.login_id,...(temporaryPassword?{temporaryPassword}:{})})
 }catch(e){return json({error:(e as Error).message==='AUTH_RATE_LIMIT'?'しばらく待ってから操作してください。':'担当者を更新できませんでした。'},400)}}
