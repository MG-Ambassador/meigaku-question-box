import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import { setFirestore } from '../src/firestore.js';

/**
 * 認証テスト用の最小限のインメモリ Firestore。
 * doc の get/set/update/delete、== 条件の where、全件 get、読み取り後に書き込むトランザクションを再現する。
 */
export function installFakeFirestore() {
  const records = new Map<string, any>();

  function ref(collection: string, id: string): any {
    const key = `${collection}/${id}`;
    const self: any = {
      id,
      key,
      get: async () => snap(key),
      set: async (data: any, opts?: { merge?: boolean }) => write(key, data, opts),
      update: async (data: any) => update(key, data),
      delete: async () => void records.delete(key),
    };
    return self;
  }
  function snap(key: string) {
    const [collection, id] = key.split('/');
    return { id, exists: records.has(key), data: () => records.get(key), ref: ref(collection, id) };
  }
  function write(key: string, data: any, opts?: { merge?: boolean }) {
    records.set(key, opts?.merge ? { ...(records.get(key) || {}), ...data } : { ...data });
  }
  function update(key: string, data: any) {
    if (!records.has(key)) throw new Error(`NOT_FOUND: ${key}`);
    records.set(key, { ...records.get(key), ...data });
  }
  function query(collection: string, predicates: [string, any][] = []): any {
    return {
      doc: (id: string) => ref(collection, id),
      where: (field: string, op: string, value: any) => {
        assert.equal(op, '==');
        return query(collection, [...predicates, [field, value]]);
      },
      get: async () => ({
        docs: [...records.keys()]
          .filter((key) => key.startsWith(`${collection}/`))
          .filter((key) => predicates.every(([field, value]) => records.get(key)[field] === value))
          .map(snap),
      }),
    };
  }

  setFirestore({
    collection: (name: string) => query(name),
    runTransaction: async (fn: any) => {
      let wrote = false;
      const writes: (() => void)[] = [];
      const result = await fn({
        get: async (r: any) => {
          assert.equal(wrote, false, 'all reads precede writes');
          return snap(r.key);
        },
        set: (r: any, data: any, opts?: { merge?: boolean }) => { wrote = true; writes.push(() => write(r.key, data, opts)); },
        update: (r: any, data: any) => { wrote = true; writes.push(() => update(r.key, data)); },
        delete: (r: any) => { wrote = true; writes.push(() => void records.delete(r.key)); },
      });
      for (const apply of writes) apply();
      return result;
    },
  } as unknown as Firestore);

  return { records };
}
