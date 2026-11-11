import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  isPasswordHash,
  normalizeLoginId,
  passwordValid,
  generateTemporaryPassword,
} from '../src/password.js';

test('hashPassword: salted scrypt hash in the legacy format verifies only the right password', async () => {
  const a = await hashPassword('correct horse battery staple');
  const b = await hashPassword('correct horse battery staple');
  assert.ok(isPasswordHash(a));
  assert.match(a, /^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.notEqual(a, b, 'each hash has its own salt');
  assert.equal(await verifyPassword('correct horse battery staple', a), true);
  assert.equal(await verifyPassword('correct horse battery stapl', a), false);
});

test('verifyPassword: missing or malformed hashes still compute and always fail', async () => {
  assert.equal(await verifyPassword('anything', undefined), false);
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', 'plain-text'), false);
  // ダミーハッシュ（全0）と同じ入力でも成功しない
  assert.equal(await verifyPassword('', `scrypt$16384$8$5$${'0'.repeat(32)}$${'0'.repeat(64)}`), false);
});

test('normalizeLoginId: 3-40 chars of [A-Za-z0-9_-], lower-cased', () => {
  assert.equal(normalizeLoginId('MGA-Owner_1'), 'mga-owner_1');
  assert.equal(normalizeLoginId('ab'), null);
  assert.equal(normalizeLoginId('a'.repeat(41)), null);
  assert.equal(normalizeLoginId('owner@example.com'), null);
  assert.equal(normalizeLoginId('../owner'), null);
  assert.equal(normalizeLoginId(123), null);
});

test('passwordValid: 15-128 characters counted by code point', () => {
  assert.equal(passwordValid('x'.repeat(14)), false);
  assert.equal(passwordValid('x'.repeat(15)), true);
  assert.equal(passwordValid('😀'.repeat(15)), true);
  assert.equal(passwordValid('x'.repeat(129)), false);
  assert.equal(passwordValid(undefined), false);
});

test('generateTemporaryPassword: 24 URL-safe characters, unique', () => {
  const a = generateTemporaryPassword();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, generateTemporaryPassword());
});
