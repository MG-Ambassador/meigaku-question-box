#!/usr/bin/env node

/**
 * scripts/backfill-category-order-and-status.mjs
 * 
 * 既存の Firestore 質問ドキュメントに `categoryOrder` を補完し、
 * 既存イベントドキュメントに `status: 'active'` を補完するマイグレーションスクリプト。
 * 
 * 使い方:
 *   node scripts/backfill-category-order-and-status.mjs [--dry-run] [--event <eventId>]
 *   node scripts/backfill-category-order-and-status.mjs --execute [--event <eventId>]
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(path.join(__dirname, '../server/package.json'));
const { Firestore, Timestamp } = require('@google-cloud/firestore');

const CATEGORY_ORDER = {
  '大学生活': 0,
  '学び・授業': 1,
  '入試・進路': 2,
  '留学・国際交流': 3,
  'その他': 4,
};

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = !isExecute;

let targetEventId = null;
const eventIdx = args.indexOf('--event');
if (eventIdx !== -1 && args[eventIdx + 1]) {
  targetEventId = args[eventIdx + 1];
}

console.log('========================================================');
console.log(' Cloud Firestore 既存データ補完スクリプト (categoryOrder & status)');
console.log('========================================================');
console.log(`[実行モード] ${isExecute ? 'EXECUTE (Firestoreへ書き込み)' : 'DRY-RUN (シミュレーション・レポートのみ)'}`);
if (targetEventId) {
  console.log(`[対象イベント] ${targetEventId}`);
} else {
  console.log('[対象イベント] 全イベント / 全質問');
}

async function run() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const databaseId = process.env.FIRESTORE_DATABASE_ID;

  const firestore = new Firestore({
    projectId: projectId || undefined,
    databaseId: databaseId || '(default)',
    ignoreUndefinedProperties: true,
  });

  // 1. イベントの補完
  console.log('\n--- 1. イベント (events) の status 補完確認 ---');
  let eventDocs = [];
  if (targetEventId) {
    const doc = await firestore.collection('events').doc(targetEventId).get();
    if (doc.exists) eventDocs.push(doc);
  } else {
    const snap = await firestore.collection('events').get();
    eventDocs = snap.docs;
  }

  const eventsToUpdate = [];
  for (const doc of eventDocs) {
    const data = doc.data();
    if (!data.status) {
      eventsToUpdate.push({
        ref: doc.ref,
        id: doc.id,
        title: data.title,
        status: 'active',
      });
    }
  }

  console.log(`調査イベント件数: ${eventDocs.length} 件`);
  console.log(`status 補完対象: ${eventsToUpdate.length} 件`);
  for (const item of eventsToUpdate) {
    console.log(`  [イベント] ${item.id} "${item.title}": status -> 'active'`);
  }

  // 2. 質問の categoryOrder 補完
  console.log('\n--- 2. 質問 (questions) の categoryOrder 補完確認 ---');
  let questionsQuery = firestore.collection('questions');
  if (targetEventId) {
    questionsQuery = questionsQuery.where('eventId', '==', targetEventId);
  }
  const questionSnap = await questionsQuery.get();
  const questionsToUpdate = [];

  for (const doc of questionSnap.docs) {
    const data = doc.data();
    if (data.categoryOrder === undefined || data.categoryOrder === null) {
      const order = CATEGORY_ORDER[data.category] ?? 4;
      questionsToUpdate.push({
        ref: doc.ref,
        id: doc.id,
        category: data.category,
        categoryOrder: order,
      });
    }
  }

  console.log(`調査質問件数: ${questionSnap.docs.length} 件`);
  console.log(`categoryOrder 補完対象: ${questionsToUpdate.length} 件`);
  if (questionsToUpdate.length > 0) {
    console.log(`補完サンプル (最大5件):`);
    for (const item of questionsToUpdate.slice(0, 5)) {
      console.log(`  [質問] ${item.id} (カテゴリ: "${item.category}") -> categoryOrder: ${item.categoryOrder}`);
    }
  }

  // Theme-ordered favorite queries require categoryOrder on pre-existing records.
  let favoritesQuery = firestore.collection('userFavorites');
  if (targetEventId) favoritesQuery = favoritesQuery.where('eventId', '==', targetEventId);
  const favorites = (await favoritesQuery.get()).docs.filter(doc => doc.data().categoryOrder == null);
  console.log(`お気に入り categoryOrder 補完対象: ${favorites.length} 件`);
  if (isExecute) {
    for (const doc of favorites) {
      await firestore.runTransaction(async transaction => {
        const fresh = await transaction.get(doc.ref);
        if (!fresh.exists || fresh.data().categoryOrder != null) return;
        const data = fresh.data();
        const id = crypto.createHash('sha256').update(JSON.stringify([data.sub, data.eventId])).digest('hex');
        const revisionRef = firestore.collection('favoriteStates').doc(id);
        const revision = await transaction.get(revisionRef);
        transaction.update(doc.ref, { categoryOrder: CATEGORY_ORDER[data.category] ?? 4 });
        transaction.set(revisionRef, { revision: (revision.data()?.revision ?? 0) + 1, updatedAt: Timestamp.now() });
      });
    }
  }

  if (isDryRun) {
    console.log('\n[結果] DRY-RUN 完了。Firestore への書き込みは行われませんでした。');
    console.log('実際に Firestore に書き込むには `--execute` オプションを付けて実行してください。');
    return;
  }

  // 3. 書き込み実行
  console.log('\nFirestore への書き込みを開始します...');
  const now = Timestamp.now();
  const batchSize = 400;

  // イベント更新バッチ
  if (eventsToUpdate.length > 0) {
    let eventBatch = firestore.batch();
    let opCount = 0;
    for (const ev of eventsToUpdate) {
      eventBatch.update(ev.ref, {
        status: ev.status,
        updatedAt: now,
      });
      opCount++;
      if (opCount >= batchSize) {
        await eventBatch.commit();
        eventBatch = firestore.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) {
      await eventBatch.commit();
    }
    console.log(`イベント ${eventsToUpdate.length} 件の status を更新しました。`);
  }

  // 質問更新バッチ
  if (questionsToUpdate.length > 0) {
    let qBatch = firestore.batch();
    let qOpCount = 0;
    for (const q of questionsToUpdate) {
      qBatch.update(q.ref, {
        categoryOrder: q.categoryOrder,
      });
      qOpCount++;
      if (qOpCount >= batchSize) {
        await qBatch.commit();
        qBatch = firestore.batch();
        qOpCount = 0;
      }
    }
    if (qOpCount > 0) {
      await qBatch.commit();
    }
    console.log(`質問 ${questionsToUpdate.length} 件の categoryOrder を更新しました。`);
  }

  console.log('\n[完了] すべてのデータ補完が正常に完了しました。');
}

run().catch((err) => {
  console.error('\nエラーが発生しました:', err);
  process.exit(1);
});
