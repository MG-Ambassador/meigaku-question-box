import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [action, target] = process.argv.slice(2);
if (!['build', 'migrate', 'deploy', 'backup'].includes(action) || !['staging', 'production'].includes(target)) {
  throw Error('Usage: node scripts/cloudflare.mjs build|migrate|deploy|backup staging|production');
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const database = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(database ?? '') || database === '00000000-0000-4000-8000-000000000000') {
  throw Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID for the selected environment.');
}
// Generate a complete, environment-specific config. Never inherit preview bindings.
const config = {
  name: `meigaku-question-box-${target}`,
  account_id: account,
  main: 'vinext/server/fetch-handler',
  compatibility_date: '2026-09-15',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  preview_urls: false,
  // Use the Workers Free defaults; no paid CPU allowance.
  observability: { enabled: true, head_sampling_rate: 0.1 },
  d1_databases: [{ binding: 'DB', database_name: `meigaku-question-box-${target}`, database_id: database, migrations_dir: 'drizzle' }],
};
const configPath = resolve('wrangler.generated.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
if (action === 'build') {
  run(['scripts/run-framework.mjs', 'build'], { MGA_CLOUDFLARE_CONFIG: configPath });
  const built = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  if (built.name !== config.name || built.account_id !== account || built.d1_databases?.[0]?.database_id !== database) throw Error('Built deployment does not match selected environment.');
  writeFileSync('dist/deployment-target.json', JSON.stringify({ target, account, database }));
} else if (action === 'migrate') {
  run([wrangler, 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]);
} else if (action === 'deploy') {
  throw Error('Deployment paused: ID/password authentication must be validated for Workers Free before publishing.');
  const built = JSON.parse(readFileSync('dist/deployment-target.json', 'utf8'));
  if (built.target !== target || built.account !== account || built.database !== database) throw Error('Rebuild for the selected deployment target first.');
  run([wrangler, 'deploy', '--config', 'dist/server/wrangler.json']);
} else {
  mkdirSync('backups', { recursive: true, mode: 0o700 });
  const file = `backups/${target}-${new Date().toISOString().replaceAll(':', '-')}.sql`;
  run([wrangler, 'd1', 'export', 'DB', '--remote', '--config', configPath, '--output', file]);
  chmodSync(file, 0o600);
  console.log('Database backup saved locally; do not commit or upload it.');
}
