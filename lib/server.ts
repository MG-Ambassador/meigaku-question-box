import {env} from 'cloudflare:workers';
import {operator} from './password-auth';
export function db(){if(!env.DB)throw Error('Storage unavailable');return env.DB}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export async function admin(){const u=await operator();return u&&!u.mustChange?u:null}
export async function payload(r:Request){if(r.headers.get('origin')!==new URL(r.url).origin)throw Error('ORIGIN');if(!r.headers.get('content-type')?.startsWith('application/json'))throw Error('INPUT');const reader=r.body?.getReader();if(!reader)throw Error('INPUT');let bytes=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();throw Error('INPUT')}chunks.push(value)}const b=new Uint8Array(bytes);let n=0;for(const x of chunks){b.set(x,n);n+=x.length}return JSON.parse(new TextDecoder().decode(b))}
export function questionInput(p:any){const body=typeof p.body==='string'?p.body.trim():'';const cats=['大学生活','学び・授業','入試・進路','留学・国際交流','その他'];if(body.length<5||body.length>500||!cats.includes(p.category))throw Error('INPUT');return {body,category:p.category}}
