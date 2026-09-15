import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const target = process.argv[2];
if (!['staging', 'production'].includes(target)) throw Error('Choose staging or production.');
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const hash = `scrypt$16384$8$5$${salt}$${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }).toString('hex')}`;
mkdirSync('outputs', { recursive: true, mode: 0o700 });
// Exclusive creation prevents accidentally replacing a delivered credential.
writeFileSync(`outputs/${target}-bootstrap.json`, JSON.stringify({ INITIAL_OPERATOR_HASH: hash }, null, 2), { mode: 0o600, flag: 'wx' });
writeFileSync(`outputs/${target}-login.txt`, `運営ID: mga-owner\n初回パスワード: ${password}\n初回ログイン後に変更してください。\n`, { mode: 0o600, flag: 'wx' });
console.log(`Created protected files for ${target} in outputs/. No existing account was changed.`);
