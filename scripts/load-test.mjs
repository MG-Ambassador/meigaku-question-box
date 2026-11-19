#!/usr/bin/env node

/**
 * scripts/load-test.mjs
 *
 * 質問投稿 API（POST /api/questions）の負荷試験。依存パッケージなし（Node 22 以上）。
 * 前の応答を待たずに、決めた到着間隔で送り続ける（オープンループ）。
 *
 * 使い方:
 *   node scripts/load-test.mjs --api <API_BASE_URL> --event <部屋ID> [オプション]
 *
 * 送り方（どちらか）:
 *   --rate <毎分の件数> --duration <秒>     一定ペースで送る（既定: 毎分60件 × 60秒）
 *   --burst <件数> --window <秒>            指定秒数の中に一斉に送る
 *
 * オプション:
 *   --per-client <n>     1端末（clientId）あたりの投稿数。既定 5（端末ごとの上限と同じ）
 *   --ips <n>            X-Forwarded-For で n 個の送信元 IP を装う（ローカル試験専用。
 *                        本番では Google Front End が実 IP を付けるので効かない）。既定 0 = 付けない
 *   --timeout <ms>       1件の待ち時間。既定 15000（画面と同じ）
 *   --resend-uncertain   503・タイムアウト・通信エラーになった投稿を、同じ requestId で1回だけ再送する
 *                        （来場者が「もう一度送る」を押した場合の再現。重複しないことの確認）
 *   --label <名前>       結果に付ける名前
 *   --out <path>         結果を JSON で保存する
 *
 * 例:
 *   node scripts/load-test.mjs --api http://localhost:8080 --event loadtest --rate 120 --duration 60 --ips 50
 */

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string' },
    event: { type: 'string' },
    rate: { type: 'string' },
    duration: { type: 'string' },
    burst: { type: 'string' },
    window: { type: 'string' },
    'per-client': { type: 'string', default: '5' },
    ips: { type: 'string', default: '0' },
    timeout: { type: 'string', default: '15000' },
    'resend-uncertain': { type: 'boolean', default: false },
    label: { type: 'string' },
    out: { type: 'string' },
  },
});

if (!args.api || !args.event) {
  console.error('Usage: node scripts/load-test.mjs --api <API_BASE_URL> --event <EVENT_ID> [--rate N --duration S | --burst N --window S]');
  process.exit(1);
}

const apiBase = new URL(args.api.replace(/\/+$/, '') + '/');
const endpoint = new URL('api/questions', apiBase);
const perClient = Math.max(1, Number(args['per-client']));
const ipCount = Math.max(0, Number(args.ips));
const timeoutMs = Math.max(1, Number(args.timeout));

const CATEGORIES = ['大学生活', '学び・授業', '入試・進路', '留学・国際交流', 'その他'];

// 送信予定（開始からのミリ秒）を作る
let schedule;
let mode;
if (args.burst) {
  const n = Number(args.burst);
  const windowMs = Number(args.window ?? 10) * 1000;
  schedule = Array.from({ length: n }, (_, i) => (n <= 1 ? 0 : (windowMs * i) / n));
  mode = `burst ${n}件 / ${windowMs / 1000}秒`;
} else {
  const ratePerMin = Number(args.rate ?? 60);
  const durationMs = Number(args.duration ?? 60) * 1000;
  const interval = 60000 / ratePerMin;
  const n = Math.floor(durationMs / interval);
  schedule = Array.from({ length: n }, (_, i) => i * interval);
  mode = `rate 毎分${ratePerMin}件 × ${durationMs / 1000}秒`;
}

const clientIds = [];
function clientIdFor(index) {
  const c = Math.floor(index / perClient);
  while (clientIds.length <= c) clientIds.push(randomUUID());
  return clientIds[c];
}
function ipFor(index) {
  if (ipCount === 0) return null;
  const n = Math.floor(index / perClient) % ipCount;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

async function send(payload, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['X-Forwarded-For'] = ip;
  const started = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = performance.now() - started;
    let code = null;
    try {
      const json = await res.json();
      code = json?.error?.code ?? null;
    } catch {
      /* 本文が JSON でない（Cloud Run 手前の 429/503 など） */
    }
    return { status: res.status, code, latency };
  } catch (error) {
    const latency = performance.now() - started;
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { status: isTimeout ? 'timeout' : 'network-error', code: error?.cause?.code ?? error?.name ?? null, latency };
  }
}

const isUncertain = (r) => r.status === 503 || r.status === 'timeout' || r.status === 'network-error';

console.log(`=== 負荷試験 ${args.label ? `[${args.label}] ` : ''}${mode} → ${endpoint.href}`);
console.log(`部屋: ${args.event} / 1端末 ${perClient}件 / 送信元IP ${ipCount === 0 ? '装わない' : `${ipCount}個`} / 予定 ${schedule.length}件`);

const results = new Array(schedule.length);
const t0 = performance.now();
let lastLog = t0;

await Promise.all(
  schedule.map(async (at, i) => {
    const wait = at - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const payload = {
      eventId: args.event,
      body: `負荷試験の質問 #${i + 1}（${args.label ?? 'load-test'}）`,
      category: CATEGORIES[i % CATEGORIES.length],
      source: i % 4 === 0 ? 'instagram' : 'web',
      requestId: randomUUID(),
      clientId: clientIdFor(i),
    };
    const ip = ipFor(i);
    const sentAt = performance.now() - t0;
    const r = await send(payload, ip);
    results[i] = { ...r, sentAt, payload, ip };
    const now = performance.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      const done = results.filter(Boolean).length;
      console.log(`  ${((now - t0) / 1000).toFixed(0)}秒: ${done}/${schedule.length} 件応答`);
    }
  })
);
const elapsedMs = performance.now() - t0;

// 503・タイムアウトを同じ requestId で1回だけ再送（冪等性の確認）
let resend = null;
if (args['resend-uncertain']) {
  const targets = results.filter(isUncertain);
  const outcomes = await Promise.all(targets.map((r) => send(r.payload, r.ip)));
  resend = {
    attempted: targets.length,
    byStatus: tally(outcomes.map((o) => `${o.status}${o.code ? ` ${o.code}` : ''}`)),
    // 201 = 1回目は書かれていなかった / 200 = 1回目で実は書けていた（重複せずに済んだ）
    recoveredAsNew: outcomes.filter((o) => o.status === 201).length,
    alreadyAccepted: outcomes.filter((o) => o.status === 200).length,
  };
}

function tally(list) {
  return list.reduce((acc, k) => ((acc[k] = (acc[k] || 0) + 1), acc), {});
}
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}
function latencyStats(list) {
  const s = list.map((r) => r.latency).sort((a, b) => a - b);
  return {
    count: s.length,
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.length ? Math.round(s[s.length - 1]) : null,
  };
}

// 10秒ごとの内訳（どの時間帯から崩れたかを見る）
const buckets = {};
for (const r of results) {
  const b = Math.floor(r.sentAt / 10000) * 10;
  buckets[b] ??= { sent: 0, ok: 0, rateLimited: 0, uncertain: 0, latencies: [] };
  buckets[b].sent += 1;
  if (r.status === 201) buckets[b].ok += 1;
  else if (r.status === 429) buckets[b].rateLimited += 1;
  else if (isUncertain(r)) buckets[b].uncertain += 1;
  if (r.status === 201) buckets[b].latencies.push(r.latency);
}
const timeline = Object.entries(buckets).map(([sec, b]) => ({
  fromSec: Number(sec),
  sent: b.sent,
  ok: b.ok,
  rateLimited: b.rateLimited,
  uncertain: b.uncertain,
  p95: percentile(b.latencies.sort((x, y) => x - y), 95),
}));

const accepted = results.filter((r) => r.status === 201);
const summary = {
  label: args.label ?? null,
  mode,
  endpoint: endpoint.href,
  eventId: args.event,
  startedAt: new Date(Date.now() - elapsedMs).toISOString(),
  elapsedSec: Number((elapsedMs / 1000).toFixed(1)),
  planned: schedule.length,
  clients: clientIds.length,
  ips: ipCount,
  byStatus: tally(results.map((r) => `${r.status}${r.code ? ` ${r.code}` : ''}`)),
  accepted: accepted.length,
  successRate: Number(((accepted.length / results.length) * 100).toFixed(2)),
  uncertainRate: Number(((results.filter(isUncertain).length / results.length) * 100).toFixed(2)),
  latencyAcceptedMs: latencyStats(accepted),
  latencyAllMs: latencyStats(results),
  resend,
  expectedTotalIncrease: accepted.length + (resend?.recoveredAsNew ?? 0),
  timeline,
};

console.log('\n--- 結果 ---');
console.log(`経過 ${summary.elapsedSec}秒 / 予定 ${summary.planned}件 / 端末 ${summary.clients}`);
console.log('応答の内訳:', summary.byStatus);
console.log(`成功率 ${summary.successRate}% / 結果不明(503・タイムアウト) ${summary.uncertainRate}%`);
console.log('応答時間(成功, ms):', summary.latencyAcceptedMs);
if (resend) console.log('同じ requestId での再送:', resend);
console.log(`部屋の集計で増えているはずの件数: ${summary.expectedTotalIncrease}`);
console.log('10秒ごと:');
for (const t of timeline) {
  console.log(`  ${String(t.fromSec).padStart(4)}秒〜 送信${t.sent} 成功${t.ok} 制限${t.rateLimited} 不明${t.uncertain} p95=${t.p95 ?? '-'}ms`);
}

if (args.out) {
  await writeFile(args.out, JSON.stringify(summary, null, 2));
  console.log(`\n結果を保存しました: ${args.out}`);
}
