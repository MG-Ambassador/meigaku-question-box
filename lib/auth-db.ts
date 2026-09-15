import {env} from 'cloudflare:workers';
export function authDb(){if(!env.DB)throw Error('AUTH_UNAVAILABLE');return env.DB}
export const sessionCookie='__Host-mga-admin';
export const challengeCookie='__Host-mga-challenge';
export const cookieOptions={httpOnly:true,secure:true,sameSite:'strict' as const,path:'/'};
export const challengeSeconds=600;
export const sessionSeconds=3600;
export function randomSecret(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')}
export async function digestSecret(secret:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));return Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('')}
export function validSecret(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)}
// Atomic, database-backed limits shared by Worker instances.
export async function authLimit(scope:string,value:string,seconds:number,max:number){const now=Date.now();const key='auth:'+scope+':'+await digestSecret(value+':'+Math.floor(now/(seconds*1000)));const row=await authDb().prepare('INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+seconds*1000).first<{count:number}>();if(!row||row.count>max)throw Error('AUTH_RATE_LIMIT');}
