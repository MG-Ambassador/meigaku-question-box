#!/usr/bin/env node

/**
 * scripts/rebuild-event-stats.mjs
 * 
 * Cloud Firestore 内の質問データを全件走査し、eventStats を再構築・修復するスクリプト
 * 
 * 使い方:
 *   node scripts/rebuild-event-stats.mjs [--dry-run] [--event <eventId>]
 *   node scripts/rebuild-event-stats.mjs --execute [--event <eventId>] [--bump-version]
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = !isExecute;
const shouldBumpVersion = args.includes('--bump-version');

let targetEventId = null;
const eventIdx = args.indexOf('--event');
if (eventIdx !== -1 && args[eventIdx + 1]) {
  targetEventId = args[eventIdx + 1];
}

console.log(`[実行モード] ${isExecute ? 'EXECUTE (Firestoreへ書き込み)' : 'DRY-RUN (集計検証・レポートのみ)'}`);
if (targetEventId) {
  console.log(`[対象イベント] ${targetEventId}`);
} else {
  console.log('[対象イベント] 全イベント');
}

// JST 日付生成 (YYYY-MM-DD)
function formatDayJst(date) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

async function rebuildStats() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const databaseId = process.env.FIRESTORE_DATABASE_ID;

  const firestore = new Firestore({
    projectId: projectId || undefined,
    databaseId: databaseId || '(default)',
    ignoreUndefinedProperties: true,
  });

  // 1. 対象イベントの取得
  let eventDocs = [];
  if (targetEventId) {
    const doc = await firestore.collection('events').doc(targetEventId).get();
    if (doc.exists) {
      eventDocs.push(doc);
    } else {
      console.error(`エラー: イベント [${targetEventId}] が見つかりません。`);
      process.exit(1);
    }
  } else {
    const snap = await firestore.collection('events').get();
    eventDocs = snap.docs;
  }

  console.log(`対象イベント数: ${eventDocs.length} 件`);

  // 2. 各イベントごとに質問を走査して集計
  for (const evDoc of eventDocs) {
    const eventId = evDoc.id;
    const evData = evDoc.data();
    console.log(`\n--- イベント [${eventId}]: "${evData.title}" ---`);

    // 既存の集計ドキュメントを取得
    const statsDocRef = firestore.collection('eventStats').doc(eventId);
    const existingStatsSnap = await statsDocRef.get();
    const existingStats = existingStatsSnap.exists ? existingStatsSnap.data() : null;

    // 質問一覧を取得（sequence 昇順）
    const questionsSnap = await firestore
      .collection('questions')
      .where('eventId', '==', eventId)
      .orderBy('sequence', 'asc')
      .get();

    const questions = questionsSnap.docs;
    console.log(`Firestore 内の質問件数: ${questions.length} 件`);

    const categoriesCount = {};
    const sourcesCount = {};
    const daysCount = {};
    let maxSequence = 0;

    for (const qDoc of questions) {
      const q = qDoc.data();
      const seq = q.sequence || 0;
      if (seq > maxSequence) maxSequence = seq;

      const cat = q.category || 'その他';
      const src = q.source || 'web';
      categoriesCount[cat] = (categoriesCount[cat] || 0) + 1;
      sourcesCount[src] = (sourcesCount[src] || 0) + 1;

      // 日付
      let dayJst = q.dayJst;
      if (!dayJst && q.createdAt) {
        dayJst = formatDayJst(q.createdAt.toDate());
      }
      if (dayJst) {
        daysCount[dayJst] = (daysCount[dayJst] || 0) + 1;
      }
    }

    // 直近30日
    const sortedDays = Object.keys(daysCount).sort();
    const recentDays = {};
    const sliceDays = sortedDays.length > 30 ? sortedDays.slice(sortedDays.length - 30) : sortedDays;
    for (const d of sliceDays) {
      recentDays[d] = daysCount[d];
    }

    const currentVersion = existingStats?.dataVersion || 1;
    const newDataVersion = shouldBumpVersion ? currentVersion + 1 : currentVersion;

    const computedStats = {
      total: questions.length,
      lastSequence: maxSequence,
      categories: categoriesCount,
      sources: sourcesCount,
      recentDays,
      updatedAt: Timestamp.now(),
      dataVersion: newDataVersion,
      schemaVersion: 1,
    };

    console.log('再計算された集計:');
    console.log(`  - 総数 (total): ${computedStats.total} (既存: ${existingStats?.total ?? 'なし'})`);
    console.log(`  - 最大sequence: ${computedStats.lastSequence} (既存: ${existingStats?.lastSequence ?? 'なし'})`);
    console.log(`  - カテゴリ内訳:`, computedStats.categories);
    console.log(`  - 流入元内訳:`, computedStats.sources);
    console.log(`  - dataVersion: ${computedStats.dataVersion}`);

    if (isExecute) {
      await statsDocRef.set(computedStats, { merge: true });
      console.log(`  => eventStats [${eventId}] を更新しました。`);
    }
  }

  if (isDryRun) {
    console.log('\n[結果] DRY-RUN 完了。Firestore への書き込みは行われませんでした。');
    console.log('実際に Firestore に反映するには `--execute` オプションを付けて実行してください。');
  } else {
    console.log('\n[完了] すべてのイベント集計の再構築が完了しました！');
  }
}

rebuildStats().catch((err) => {
  console.error('集計再構築スクリプト実行中にエラーが発生しました:', err);
  process.exit(1);
});
