#!/usr/bin/env node

/**
 * server/scripts/load-test-fixture.mjs
 *
 * 負荷試験（scripts/load-test.mjs）用の部屋の準備・照合。
 * 安全のため Firestore エミュレータ（FIRESTORE_EMULATOR_HOST）でだけ動く。
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=demo-qabox \
 *     node server/scripts/load-test-fixture.mjs seed   --event loadtest
 *     node server/scripts/load-test-fixture.mjs verify --event loadtest [--expect N]
 *
 * verify で見ること:
 *   - 集計 eventStats.total と、実際の質問ドキュメント数が一致するか
 *   - sequence（受付番号）が 1..N で重複・欠番なく振られているか
 *   - --expect を渡したら、負荷試験で 201 を受け取った件数とも一致するか
 */

import { parseArgs } from 'node:util';
import { Firestore, Timestamp } from '@google-cloud/firestore';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    event: { type: 'string', default: 'loadtest' },
    expect: { type: 'string' },
  },
});

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST が未設定です。このスクリプトはエミュレータ専用です。');
  process.exit(1);
}

const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'demo-qabox' });
const eventId = args.event;
const command = positionals[0];

if (command === 'seed') {
  const now = Timestamp.now();
  // 部屋を作り直す（前回の質問・集計は消す）
  const old = await db.collection('questions').where('eventId', '==', eventId).get();
  for (let i = 0; i < old.docs.length; i += 400) {
    const batch = db.batch();
    old.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.collection('eventStats').doc(eventId).delete();
  await db.collection('events').doc(eventId).set({
    title: '負荷試験用の部屋',
    date: '',
    open: true,
    status: 'active',
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'load-test',
    schemaVersion: 1,
  });
  // 前回の投稿制限の記録も消す
  const limits = await db.collection('rateLimits').get();
  for (let i = 0; i < limits.docs.length; i += 400) {
    const batch = db.batch();
    limits.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`部屋 ${eventId} を用意しました（質問 ${old.size}件・制限記録 ${limits.size}件を消去）`);
} else if (command === 'verify') {
  const stats = (await db.collection('eventStats').doc(eventId).get()).data() ?? { total: 0, lastSequence: 0 };
  const snap = await db.collection('questions').where('eventId', '==', eventId).select('sequence').get();
  const sequences = snap.docs.map((d) => d.get('sequence')).sort((a, b) => a - b);
  const dupes = sequences.filter((s, i) => i > 0 && s === sequences[i - 1]).length;
  const missing = sequences.length ? sequences[sequences.length - 1] - new Set(sequences).size : 0;
  const result = {
    eventId,
    statsTotal: stats.total,
    statsLastSequence: stats.lastSequence,
    questionDocs: snap.size,
    sequenceDuplicates: dupes,
    sequenceGaps: missing,
    expected: args.expect != null ? Number(args.expect) : null,
  };
  const ok =
    result.statsTotal === result.questionDocs &&
    result.statsLastSequence === result.questionDocs &&
    dupes === 0 &&
    missing === 0 &&
    (result.expected == null || result.expected === result.questionDocs);
  console.log(JSON.stringify({ ...result, consistent: ok }, null, 2));
  process.exit(ok ? 0 : 2);
} else {
  console.error('Usage: load-test-fixture.mjs <seed|verify> --event <ID> [--expect N]');
  process.exit(1);
}
