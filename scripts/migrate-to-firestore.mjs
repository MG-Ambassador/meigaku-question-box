#!/usr/bin/env node

/**
 * scripts/migrate-to-firestore.mjs
 * 
 * Cloudflare D1 (SQLite) から Cloud Firestore へのデータ移行スクリプト
 * 
 * 使い方:
 *   node scripts/migrate-to-firestore.mjs [--dry-run] [--sqlite <path>]
 *   node scripts/migrate-to-firestore.mjs --execute [--sqlite <path>]
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 引数解析
const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = !isExecute; // デフォルトは dry-run

let sqlitePath = null;
const sqliteIdx = args.indexOf('--sqlite');
if (sqliteIdx !== -1 && args[sqliteIdx + 1]) {
  sqlitePath = path.resolve(args[sqliteIdx + 1]);
} else {
  // 自動検出: .wrangler/state/v3/d1/miniflare-D1DatabaseObject/ 内の .sqlite ファイル
  const d1Dir = path.join(ROOT_DIR, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (fs.existsSync(d1Dir)) {
    const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'));
    if (files.length > 0) {
      sqlitePath = path.join(d1Dir, files[0]);
    }
  }
}

if (!sqlitePath || !fs.existsSync(sqlitePath)) {
  console.error('エラー: 有効な SQLite データベースファイルが見つかりません。');
  console.error('オプション `--sqlite <path>` で指定してください。');
  process.exit(1);
}

console.log(`[移行元データベース] ${sqlitePath}`);
console.log(`[実行モード] ${isExecute ? 'EXECUTE (Firestoreへ書き込み)' : 'DRY-RUN (検証・シミュレーションのみ)'}`);

// ハッシュ計算
function calculateRequestHash(eventId, category, source, body) {
  const normalized = `${eventId}:${category}:${source}:${(body || '').trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
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

async function runMigration() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });

  // 1. イベントデータの読み込み
  const rawEvents = db.prepare('SELECT id, title, date, open, created_at FROM events ORDER BY created_at ASC').all();
  console.log(`\n読み込みイベント数: ${rawEvents.length} 件`);

  const eventsMap = new Map();
  for (const ev of rawEvents) {
    const createdAtMs = Number(ev.created_at) || Date.now();
    eventsMap.set(ev.id, {
      id: ev.id,
      title: (ev.title || '').trim(),
      date: (ev.date || '').trim(),
      open: Boolean(ev.open),
      version: 1,
      createdAtMs,
      updatedAtMs: createdAtMs,
      updatedBy: 'migration-d1',
      schemaVersion: 1,
    });
  }

  // 2. 質問データの読み込み
  const rawQuestions = db.prepare('SELECT id, event_id, body, category, source, status, answer, created_at FROM questions ORDER BY created_at ASC, id ASC').all();
  console.log(`読み込み質問数: ${rawQuestions.length} 件`);

  // イベントIDごとのグルーピング
  const questionsByEvent = new Map();

  // イベントIDが空または存在しない場合のデフォルト退避イベント
  const UNASSIGNED_EVENT_ID = 'legacy-unassigned';
  if (rawQuestions.some((q) => !q.event_id || !eventsMap.has(q.event_id))) {
    eventsMap.set(UNASSIGNED_EVENT_ID, {
      id: UNASSIGNED_EVENT_ID,
      title: '旧環境移行データ（イベント未指定）',
      date: '',
      open: false,
      version: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedBy: 'migration-d1',
      schemaVersion: 1,
    });
  }

  for (const q of rawQuestions) {
    let targetEventId = q.event_id;
    if (!targetEventId || !eventsMap.has(targetEventId)) {
      targetEventId = UNASSIGNED_EVENT_ID;
    }

    if (!questionsByEvent.has(targetEventId)) {
      questionsByEvent.set(targetEventId, []);
    }
    questionsByEvent.get(targetEventId).push(q);
  }

  // 3. 質問の sequence 採番および Firestore ドキュメント形式への変換
  const convertedQuestions = [];
  const eventStatsMap = new Map();

  for (const [eventId, qList] of questionsByEvent.entries()) {
    // created_at ASC, id ASC で確定的なソート
    qList.sort((a, b) => {
      const timeDiff = Number(a.created_at) - Number(b.created_at);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id).localeCompare(String(b.id));
    });

    const categoriesCount = {};
    const sourcesCount = {};
    const daysCount = {};

    let seq = 0;
    for (const q of qList) {
      seq += 1;
      const createdAtMs = Number(q.created_at) || Date.now();
      const createdAtDate = new Date(createdAtMs);
      const dayJst = formatDayJst(createdAtDate);
      const body = (q.body || '').trim();
      const category = q.category || '大学生活';
      const source = q.source === 'instagram' ? 'instagram' : 'web';

      const requestHash = calculateRequestHash(eventId, category, source, body);

      convertedQuestions.push({
        id: q.id,
        eventId,
        body,
        category,
        source,
        requestHash,
        createdAtMs,
        dayJst,
        sequence: seq,
        schemaVersion: 1,
        // 旧データ保全用フィールド
        legacyStatus: q.status || 'pending',
        legacyAnswer: q.answer || '',
      });

      categoriesCount[category] = (categoriesCount[category] || 0) + 1;
      sourcesCount[source] = (sourcesCount[source] || 0) + 1;
      daysCount[dayJst] = (daysCount[dayJst] || 0) + 1;
    }

    // recentDays は直近30日
    const sortedDays = Object.keys(daysCount).sort();
    const recentDays = {};
    const sliceDays = sortedDays.length > 30 ? sortedDays.slice(sortedDays.length - 30) : sortedDays;
    for (const d of sliceDays) {
      recentDays[d] = daysCount[d];
    }

    eventStatsMap.set(eventId, {
      total: qList.length,
      lastSequence: seq,
      categories: categoriesCount,
      sources: sourcesCount,
      recentDays,
      updatedAtMs: Date.now(),
      dataVersion: 1,
      schemaVersion: 1,
    });
  }

  // 4. 検証レポートの出力
  console.log('\n=================== 移行検証レポート ===================');
  console.log(`移行対象イベント総数: ${eventsMap.size} 件`);
  for (const [evId, ev] of eventsMap.entries()) {
    const count = questionsByEvent.get(evId)?.length || 0;
    const stats = eventStatsMap.get(evId);
    console.log(`  - イベント [${evId}]: "${ev.title}" (公開: ${ev.open}) -> 質問 ${count} 件, maxSequence: ${stats?.lastSequence || 0}`);
  }

  console.log(`\n移行対象質問総数: ${convertedQuestions.length} 件`);
  const sampleQuestion = convertedQuestions[0];
  if (sampleQuestion) {
    console.log('変換後質問サンプル (1件目):');
    console.log(JSON.stringify(sampleQuestion, null, 2));
  }

  // 整合性チェック
  if (convertedQuestions.length !== rawQuestions.length) {
    console.error(`整合性エラー: 読み込み質問数 (${rawQuestions.length}) と変換後質問数 (${convertedQuestions.length}) が一致しません。`);
    process.exit(1);
  }
  console.log('\n整合性チェック: 全質問の件数・整合性 OK');

  if (isDryRun) {
    console.log('\n[結果] DRY-RUN 完了。Firestore への書き込みは行われませんでした。');
    console.log('実際に Firestore に書き込むには `--execute` オプションを付けて実行してください。');
    return;
  }

  // 5. Firestore への実際の書き込み (--execute)
  console.log('\nFirestore への書き込みを開始します...');
  const { Firestore, Timestamp } = await import('@google-cloud/firestore');

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const databaseId = process.env.FIRESTORE_DATABASE_ID;

  const firestore = new Firestore({
    projectId: projectId || undefined,
    databaseId: databaseId || '(default)',
    ignoreUndefinedProperties: true,
  });

  const batchSize = 400; // Firestoreの500件上限以内に収める

  // イベント書き込み
  console.log('イベント書き込み中...');
  let eventBatch = firestore.batch();
  let eventOpCount = 0;
  for (const ev of eventsMap.values()) {
    const ref = firestore.collection('events').doc(ev.id);
    eventBatch.set(ref, {
      title: ev.title,
      date: ev.date,
      open: ev.open,
      version: ev.version,
      createdAt: Timestamp.fromMillis(ev.createdAtMs),
      updatedAt: Timestamp.fromMillis(ev.updatedAtMs),
      updatedBy: ev.updatedBy,
      schemaVersion: ev.schemaVersion,
    });
    eventOpCount++;
  }
  await eventBatch.commit();
  console.log(`イベント ${eventOpCount} 件書き込み完了`);

  // 集計書き込み
  console.log('集計 (eventStats) 書き込み中...');
  let statsBatch = firestore.batch();
  for (const [evId, stats] of eventStatsMap.entries()) {
    const ref = firestore.collection('eventStats').doc(evId);
    statsBatch.set(ref, {
      total: stats.total,
      lastSequence: stats.lastSequence,
      categories: stats.categories,
      sources: stats.sources,
      recentDays: stats.recentDays,
      updatedAt: Timestamp.fromMillis(stats.updatedAtMs),
      dataVersion: stats.dataVersion,
      schemaVersion: stats.schemaVersion,
    });
  }
  await statsBatch.commit();
  console.log(`集計 ${eventStatsMap.size} 件書き込み完了`);

  // 質問書き込み（バッチ分割）
  console.log('質問ドキュメント書き込み中...');
  let qBatch = firestore.batch();
  let qOpCount = 0;
  let totalWritten = 0;

  for (const q of convertedQuestions) {
    const ref = firestore.collection('questions').doc(q.id);
    qBatch.set(ref, {
      eventId: q.eventId,
      body: q.body,
      category: q.category,
      source: q.source,
      requestHash: q.requestHash,
      createdAt: Timestamp.fromMillis(q.createdAtMs),
      dayJst: q.dayJst,
      sequence: q.sequence,
      schemaVersion: q.schemaVersion,
      legacyStatus: q.legacyStatus,
      legacyAnswer: q.legacyAnswer,
    });
    qOpCount++;

    if (qOpCount >= batchSize) {
      await qBatch.commit();
      totalWritten += qOpCount;
      console.log(`  - 質問 ${totalWritten} / ${convertedQuestions.length} 件コミット完了`);
      qBatch = firestore.batch();
      qOpCount = 0;
    }
  }

  if (qOpCount > 0) {
    await qBatch.commit();
    totalWritten += qOpCount;
    console.log(`  - 質問 ${totalWritten} / ${convertedQuestions.length} 件コミット完了`);
  }

  console.log('\n[完了] すべてのデータの移行書き込みが成功しました！');
}

runMigration().catch((err) => {
  console.error('移行スクリプト実行中にエラーが発生しました:', err);
  process.exit(1);
});
