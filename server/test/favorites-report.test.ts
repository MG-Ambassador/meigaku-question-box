import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import type { Request, Response } from 'express';
import { setFirestore } from '../src/firestore.js';
import { getAdminReportHandler, toggleQuestionFavoriteHandler } from '../src/report.js';

// In-memory query adapter: immutable queries, ordering, cursor, count and read-before-write transactions.
function fixture() {
  const records = new Map<string, any>();
  const state = { failFavorites: false, failCount: false, afterPage: () => {}, reads: [] as { collection: string; limit: number }[] };
  records.set('events/test', { status: 'active', version: 1 });
  records.set('eventStats/test', { total: 150, lastSequence: 150, dataVersion: 1, categories: { '大学生活': 75, '学び・授業': 75 }, sources: { web: 150 }, recentDays: {} });
  for (let n = 1; n <= 150; n++) records.set(`questions/q-${n}`, { eventId: 'test', sequence: n, body: `質問${n}`, category: n % 2 ? '大学生活' : '学び・授業', categoryOrder: n % 2 ? 0 : 1, source: 'web', dayJst: n % 3 ? '2026-09-30' : '2026-09-29', createdAt: { toMillis: () => n } });
  const snap = (key: string) => ({ id: key.split('/').at(-1), exists: records.has(key), data: () => records.get(key) });
  function query(collection: string, predicates: any[] = [], ordering: any[] = [], limit = Infinity, after: any[] | null = null): any {
    function matches() {
      const values = [...records].filter(([key]) => key.startsWith(`${collection}/`)).filter(([,data]) => predicates.every(([field,op,v]) => op === '==' ? data[field] === v : op === '<=' ? data[field] <= v : op === '<' ? data[field] < v : data[field] > v));
      const compare = (a: any, b: any) => { for (const [field, dir] of ordering) { const cmp = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0; if(cmp) return dir === 'desc' ? -cmp : cmp; } return 0; };
      values.sort((a,b) => compare(a[1],b[1]));
      return after ? values.filter(([,data]) => compare(data,Object.fromEntries(ordering.map(([field]: any,i: number) => [field,after[i]]))) > 0) : values;
    }
    return {
      doc(id: string) { const key = `${collection}/${id}`; return { key, get: async () => { if(collection === 'userFavorites' && state.failFavorites) throw Error('favorites unavailable'); return snap(key); } }; },
      where(f: string,o: string,v: any) { return query(collection,[...predicates,[f,o,v]],ordering,limit,after); },
      orderBy(f: string,d: string) { return query(collection,predicates,[...ordering,[f,d]],limit,after); },
      startAfter(...v: any[]) { return query(collection,predicates,ordering,limit,v); },
      limit(n: number) { return query(collection,predicates,ordering,n,after); },
      count() { return { get: async () => { if(state.failCount) throw Error('count unavailable'); return { data: () => ({ count: matches().length }) }; } }; },
      async get() { if(collection === 'userFavorites' && state.failFavorites) throw Error('favorites unavailable'); state.reads.push({collection,limit}); const docs = matches().slice(0,limit).map(([key]) => snap(key)); state.afterPage(); return {docs}; },
    };
  }
  setFirestore({ collection: (name: string) => query(name), runTransaction: async (fn: any) => {
    let wrote = false; const writes: any[] = [];
    const result = await fn({get: async (ref: any) => { assert.equal(wrote,false,'all reads precede writes'); return snap(ref.key); }, set: (ref: any,data: any) => {wrote = true;writes.push([ref.key,data]);}});
    for(const [key,data] of writes) records.set(key,data); return result;
  }} as unknown as Firestore);
  return {state, records};
}
async function invoke(handler: any, query: any = {}, sub = 'alice', body?: any, id?: string) {
  let status = 200; let result: any;
  const res = {status(n: number){status = n;return res;},json(data: any){result = data;}};
  await handler({query:{event:'test',pageSize:'50',...query},adminUser:{sub},body,params:{id}} as unknown as Request,res as unknown as Response);
  return {status,body:result};
}
const report = (query: any = {},sub?: string) => invoke(getAdminReportHandler,query,sub);
const star = (n: number,value = true,sub = 'alice') => invoke(toggleQuestionFavoriteHandler,{},sub,{favorite:value},`q-${n}`);
afterEach(() => setFirestore(null));

test('old favorites use bounded database pages in every sort order', async () => {
  const {state} = fixture();
  for(let n=1;n<=120;n++) assert.equal((await star(n)).status,200);
  for(const sort of ['newest','oldest','theme']) {
    state.reads = []; let cursor: string | undefined; const ids: string[] = [];
    do { const r = await report({favorite:'favorite',sort,...(cursor ? {cursor}: {})}); assert.equal(r.status,200); assert.equal(r.body.filteredTotal,120); ids.push(...r.body.rows.map((q: any)=>q.id)); cursor=r.body.nextCursor; } while(cursor);
    assert.equal(ids.length,120); assert.equal(new Set(ids).size,120); assert.ok(ids.includes('q-1'));
    assert.ok(state.reads.filter(r=>r.collection==='userFavorites').every(r=>r.limit===51));
    if(sort==='oldest') assert.equal(ids[0],'q-1');
    if(sort==='theme') assert.equal(ids[0],'q-119');
  }
});
test('membership edits expire own cursors; idempotent PUT and another operator do not', async () => {
  fixture(); for(let n=1;n<=51;n++) await star(n);
  const first=await report({favorite:'favorite'}); const cursor=first.body.nextCursor;
  await star(1); await star(70,true,'bob'); assert.equal((await report({favorite:'favorite',cursor})).status,200);
  assert.equal((await report({favorite:'favorite',cursor},'bob')).status,400);
  await star(1,false); const expired=await report({favorite:'favorite',cursor}); assert.equal(expired.status,409); assert.equal(expired.body.error.code,'CURSOR_EXPIRED');
});
test('concurrent membership changes cannot produce a mixed page', async () => {
  const {state,records}=fixture(); await star(1);
  state.afterPage=()=>{ for(const [key,data] of records) if(key.startsWith('favoriteStates/')) records.set(key,{...data,revision:data.revision+1}); };
  assert.equal((await report({favorite:'favorite'})).status,409);
});
test('favorite read errors propagate for both favorite and ordinary lists', async () => {
  const {state}=fixture(); await star(1); state.failFavorites=true;
  for(const query of [{favorite:'favorite'},{}]) { const r=await report(query); assert.equal(r.status,503); assert.equal(r.body.error.code,'STORAGE_UNAVAILABLE'); }
});
test('intersection counts are exact and count errors never return guessed totals', async () => {
  const {state}=fixture(); const filters={category:'大学生活',source:'web',day:'2026-09-29'};
  const r=await report(filters); assert.equal(r.status,200); assert.equal(r.body.filteredTotal,25); assert.equal(r.body.rows.length,25);
  state.failCount=true; assert.equal((await report(filters)).status,503);
});
test('deleted rooms cannot read or mutate favorites', async () => {
  const {records}=fixture(); await star(1); records.set('events/test',{status:'deleted'});
  assert.equal((await report({favorite:'favorite'})).status,404); assert.equal((await star(1,false)).status,404);
});
