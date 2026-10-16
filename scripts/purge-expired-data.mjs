#!/usr/bin/env node

/**
 * scripts/purge-expired-data.mjs
 *
 * 保存期間満了データのパージ（削除）スクリプト
 * 設計書 `docs/GitHub-Pages-Google-Cloud-開発ロードマップ.md` 4節・13節に基づき、
 * 指定日数（デフォルト365日）より前に更新・作成された終了済み/ごみ箱イベント、
 * または特定イベントID (`--event <id>`) の質問・お気に入り・集計データを削除します。
 *
 * 使い方:
 *   node scripts/purge-expired-data.mjs [--dry-run] [--retention-days 365] [--event <eventId>]
 *   node scripts/purge-expired-data.mjs --execute [--retention-days 365] [--event <eventId>]
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(path.join(__dirname, '../server/package.json'));
const { Firestore } = require('@google-cloud/firestore');

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = !isExecute;

const retentionIdx = args.indexOf('--retention-days');
const retentionDays =
  retentionIdx !== -1 && args[retentionIdx + 1]
    ? Number.parseInt(args[retentionIdx + 1], 10)
    : 365;

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  console.error('エラー: --retention-days には 1 以上の整数を指定してください。');
  process.exit(1);
}

const eventIdx = args.indexOf('--event');
const targetEventId = eventIdx !== -1 && args[eventIdx + 1] ? args[eventIdx + 1].trim() : null;

const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
const cutoffDate = new Date(cutoffMs);

console.log('==================================================================');
console.log(' 明学の質問箱 保存期間満了データ削除スクリプト');
console.log('==================================================================');
console.log(`[実行モード]     ${isExecute ? 'EXECUTE (Firestoreから本削除)' : 'DRY-RUN (対象件数の確認のみ)'}`);
console.log(`[保存期間基準]   ${retentionDays} 日 (${cutoffDate.toISOString()} より前の終了済み/ごみ箱イベント)`);
if (targetEventId) {
  console.log(`[指定イベントID] ${targetEventId}`);
}

async function deleteCollectionDocs(firestore, docRefs, label) {
  if (docRefs.length === 0) {
    console.log(`  - ${label}: 0 件`);
    return 0;
  }
  if (isDryRun) {
    console.log(`  - [DRY-RUN] ${label}: ${docRefs.length} 件が削除対象です`);
    return docRefs.length;
  }

  const batchSize = 400;
  let deleted = 0;
  for (let i = 0; i < docRefs.length; i += batchSize) {
    const slice = docRefs.slice(i, i + batchSize);
    const batch = firestore.batch();
    for (const ref of slice) {
      batch.delete(ref);
    }
    await batch.commit();
    deleted += slice.length;
    console.log(`  - ${label}: ${deleted} / ${docRefs.length} 件削除完了`);
  }
  return deleted;
}

async function runPurge() {
  const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
    ignoreUndefinedProperties: true,
  });

  const eventsSnap = await firestore.collection('events').get();
  const targetEvents = [];

  for (const doc of eventsSnap.docs) {
    const data = doc.data();
    if (targetEventId) {
      if (doc.id === targetEventId) {
        targetEvents.push({ id: doc.id, ref: doc.ref, data });
      }
      continue;
    }

    const updatedAtMs =
      data.updatedAt && typeof data.updatedAt.toMillis === 'function'
        ? data.updatedAt.toMillis()
        : data.createdAt && typeof data.createdAt.toMillis === 'function'
          ? data.createdAt.toMillis()
          : 0;

    const isClosedOrArchived = data.open === false || data.status === 'archived' || data.status === 'trashed';
    if (isClosedOrArchived && updatedAtMs > 0 && updatedAtMs < cutoffMs) {
      targetEvents.push({ id: doc.id, ref: doc.ref, data });
    }
  }

  console.log(`\n対象イベント数: ${targetEvents.length} 件`);
  if (targetEvents.length === 0) {
    console.log('削除対象のイベントはありません。');
    return;
  }

  for (const ev of targetEvents) {
    console.log(`\n------------------------------------------------------------------`);
    console.log(`イベント: ${ev.id} ("${ev.data.title || ''}", status=${ev.data.status || 'active'}, open=${Boolean(ev.data.open)})`);

    const questionsSnap = await firestore.collection('questions').where('eventId', '==', ev.id).get();
    await deleteCollectionDocs(
      firestore,
      questionsSnap.docs.map((d) => d.ref),
      `questions (eventId=${ev.id})`,
    );

    const favoritesSnap = await firestore.collection('favorites').where('eventId', '==', ev.id).get();
    await deleteCollectionDocs(
      firestore,
      favoritesSnap.docs.map((d) => d.ref),
      `favorites (eventId=${ev.id})`,
    );

    const statsRef = firestore.collection('eventStats').doc(ev.id);
    const statsSnap = await statsRef.get();
    if (statsSnap.exists) {
      await deleteCollectionDocs(firestore, [statsRef], `eventStats (${ev.id})`);
    }

    await deleteCollectionDocs(firestore, [ev.ref], `events (${ev.id})`);
  }

  console.log('\n==================================================================');
  if (isDryRun) {
    console.log(' DRY-RUN 完了。実際に削除する場合は `--execute` を指定してください。');
  } else {
    console.log(' すべての対象データのパージが完了しました。');
  }
  console.log('==================================================================');
}

runPurge().catch((err) => {
  console.error('データ削除スクリプト実行中にエラーが発生しました:', err);
  process.exit(1);
});
