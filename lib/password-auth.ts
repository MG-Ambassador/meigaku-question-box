import {env} from 'cloudflare:workers';
import {cookies} from 'next/headers';
import {scryptSync,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {authDb,randomSecret,digestSecret,validSecret,cookieOptions,sessionSeconds} from './auth-db';
export const operatorCookie='__Host-mga-operator';
export type Operator={userId:string;loginId:string;displayName:string;role:string;mustChange:number;version:number};
export function loginId(value:unknown){return typeof value==='string'&&/^[a-zA-Z0-9_-]{3,40}$/.test(value)?value.toLowerCase():null}
export function passwordValid(value:unknown):value is string{return typeof value==='string'&&[...value].length>=15&&value.length<=128}
// OWASP scrypt profile: 16 MiB, r=8, p=5. Salt and cost are stored with each hash.
export function hashPassword(password:string,salt=randomSecret().slice(0,32)){return 'scrypt$16384$8$5$'+salt+'$'+scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex')}
const dummy='scrypt$16384$8$5$'+'0'.repeat(32)+'$'+'0'.repeat(64);
export function verifyPassword(password:string,encoded:string){const match=/^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);const parts=match||/^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(dummy)!;const actual=hashPassword(password,parts[1]).split('$')[5];return timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(parts[2],'hex'))&&!!match}
export function bootstrapHash(){const h=(env as unknown as Record<string,string>).INITIAL_OPERATOR_HASH;return typeof h==='string'&&/^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(h)?h:null}
export async function initializeOperator(){const h=bootstrapHash();if(!h)return;await authDb().prepare("INSERT OR IGNORE INTO operators(id,login_id,display_name,password_hash,role,active,must_change,version,created_at) VALUES ('initial-owner','mga-owner','運営責任者',?,'owner',1,1,1,?)").bind(h,Date.now()).run()}
export async function operator(){const value=(await cookies()).get(operatorCookie)?.value;if(!validSecret(value))return null;return authDb().prepare('SELECT o.id AS userId,o.login_id AS loginId,o.display_name AS displayName,o.role,o.must_change AS mustChange,o.version FROM operator_sessions s JOIN operators o ON o.id=s.operator_id AND o.version=s.version WHERE s.token_hash=? AND s.expires_at>? AND o.active=1').bind(await digestSecret(value),Date.now()).first<Operator>()}
export async function issueSession(id:string,version:number){const token=randomSecret(),hash=await digestSecret(token),jar=await cookies();const old=jar.get(operatorCookie)?.value;const out=await authDb().prepare('INSERT INTO operator_sessions(token_hash,operator_id,version,expires_at) SELECT ?,id,version,? FROM operators WHERE id=? AND version=? AND active=1').bind(hash,Date.now()+sessionSeconds*1000,id,version).run();if(!out.meta.changes)throw Error('AUTH_CHANGED');if(validSecret(old))await authDb().prepare('DELETE FROM operator_sessions WHERE token_hash=?').bind(await digestSecret(old)).run();await authDb().prepare('DELETE FROM operator_sessions WHERE expires_at<=?').bind(Date.now()).run();jar.set(operatorCookie,token,{...cookieOptions,maxAge:sessionSeconds})}
export async function logout(){const jar=await cookies(),value=jar.get(operatorCookie)?.value;if(validSecret(value))await authDb().prepare('DELETE FROM operator_sessions WHERE token_hash=?').bind(await digestSecret(value)).run();jar.set(operatorCookie,'',{...cookieOptions,maxAge:0})}
