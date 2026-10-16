#!/usr/bin/env node

/**
 * scripts/smoke-production.mjs
 *
 * GitHub Pages (フロントエンド) ＋ Google Cloud Run (バックエンド API) 構成向け本番スモークテスト
 *
 * 使い方:
 *   node scripts/smoke-production.mjs <FRONTEND_URL> [API_BASE_URL]
 *
 * 例:
 *   node scripts/smoke-production.mjs https://mg-ambassador.github.io/meigaku-question-box/ https://meigaku-question-box-api-xxxxx.asia-northeast1.run.app
 */

import assert from 'node:assert/strict';

const frontendArg = process.argv[2];
const apiArg = process.argv[3] || process.env.NEXT_PUBLIC_API_BASE_URL;

if (!frontendArg) {
  console.error('Usage: node scripts/smoke-production.mjs <FRONTEND_URL> [API_BASE_URL]');
  process.exit(1);
}

const frontendUrl = new URL(frontendArg.endsWith('/') ? frontendArg : `${frontendArg}/`);
if (frontendUrl.protocol !== 'https:' || frontendUrl.username || frontendUrl.password) {
  throw new Error('FRONTEND_URL must be an HTTPS URL without credentials.');
}

console.log(`=== Frontend Checks (${frontendUrl.href}) ===`);
for (const relPath of ['', 'admin/']) {
  const target = new URL(relPath, frontendUrl);
  const response = await fetch(target, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${target.href}: expected 200, got ${response.status}`);
  const html = await response.text();
  assert.equal(
    html.includes('開発用UI部品ギャラリー'),
    false,
    `${target.href}: dev gallery string must not be present in production HTML`,
  );
  console.log(`GET ${target.pathname}: OK (200)`);
}

if (apiArg) {
  const apiBase = new URL(apiArg.replace(/\/+$/, '') + '/');
  if (apiBase.protocol !== 'https:' || apiBase.username || apiBase.password) {
    throw new Error('API_BASE_URL must be an HTTPS URL without credentials.');
  }

  console.log(`\n=== Backend API Checks (${apiBase.origin}) ===`);

  // 1. ヘルスチェック
  const healthUrl = new URL('health', apiBase);
  const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
  assert.equal(healthRes.status, 200, `${healthUrl.pathname}: expected 200, got ${healthRes.status}`);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'ok', 'health status should be "ok"');
  console.log(`GET ${healthUrl.pathname}: OK (200, status=ok)`);

  // 2. 未認証での管理API拒否確認 (401 Unauthorized)
  for (const adminPath of ['api/admin/events', 'api/admin/report?event=smoke-check']) {
    const target = new URL(adminPath, apiBase);
    const res = await fetch(target, { signal: AbortSignal.timeout(15000) });
    assert.equal(res.status, 401, `${target.pathname}: expected 401 without Bearer token, got ${res.status}`);
    console.log(`GET ${target.pathname} (unauthenticated): OK (401 rejected)`);
  }

  // 3. 空ボディでの質問投稿拒否確認 (400 Bad Request)
  const postUrl = new URL('api/questions', apiBase);
  const postRes = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(postRes.status, 400, `POST ${postUrl.pathname}: expected 400 on empty payload, got ${postRes.status}`);
  console.log(`POST ${postUrl.pathname} (invalid payload): OK (400 rejected)`);
} else {
  console.log('\n[Info] API_BASE_URL not provided; skipped backend API checks.');
}

console.log('\nAll automated smoke checks passed.');
