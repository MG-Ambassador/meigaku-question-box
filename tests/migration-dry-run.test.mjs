import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/migrate-to-firestore.mjs');

test('migration dry-run converts fixture data without changing SQLite', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mga-migration-'));
  const sqlite = path.join(dir, 'fixture.sqlite');
  try {
    const db = new DatabaseSync(sqlite);
    try {
      const migrations = path.join(root, 'drizzle');
      for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
        db.exec(readFileSync(path.join(migrations, file), 'utf8'));
      }
      db.prepare('INSERT INTO events (id, title, created_at) VALUES (?, ?, ?)')
        .run('event-1', 'CIイベント', 1750000000000);
      const insert = db.prepare('INSERT INTO questions (id, event_id, body, category, source, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      insert.run('q-2', 'event-1', '質問2', '大学生活', 'instagram', 1750000000000);
      insert.run('q-1', 'event-1', ' 質問1 ', '大学生活', 'web', 1750000000000);
      insert.run('q-3', null, '未指定', '大学生活', 'web', 1750000001000);
      insert.run('q-4', 'missing-event', '孤立データ', '大学生活', 'web', 1750000002000);
    } finally {
      db.close();
    }
    const before = readFileSync(sqlite);
    const result = spawnSync(process.execPath, [script, '--dry-run', '--sqlite', sqlite], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /移行対象イベント総数: 2 件/);
    assert.match(result.stdout, /移行対象質問総数: 4 件/);
    assert.match(result.stdout, /\[event-1\].*質問 2 件, maxSequence: 2/);
    assert.match(result.stdout, /\[legacy-unassigned\].*質問 2 件, maxSequence: 2/);
    const sample = JSON.parse(result.stdout.match(/変換後質問サンプル \(1件目\):\n(\{[\s\S]*?\n\})/)[1]);
    assert.equal(sample.id, 'q-1');
    assert.equal(sample.sequence, 1);
    assert.equal(sample.body, '質問1');
    assert.match(result.stdout, /DRY-RUN 完了。Firestore への書き込みは行われませんでした/);
    assert.doesNotMatch(result.stdout, /Firestore への書き込みを開始/);
    assert.deepEqual(readFileSync(sqlite), before);

    const missing = spawnSync(process.execPath, [script, '--dry-run', '--sqlite', path.join(dir, 'missing.sqlite')], {
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /有効な SQLite データベースファイルが見つかりません/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
