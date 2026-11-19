import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSerialized,
  queuedCount,
  SubmissionBusyError,
  SubmissionDeadlineError,
} from '../src/submission-queue.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = { maxQueue: 100, maxWaitMs: 1000, deadlineMs: 2000 };

describe('部屋ごとの順番待ち（submission-queue）', () => {
  it('同じ部屋の処理は重ならずに1件ずつ順に動く', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        runSerialized('room-a', async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await wait(10);
          order.push(n);
          running -= 1;
          return n;
        }, opts)
      )
    );
    assert.equal(maxRunning, 1);
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
    assert.equal(queuedCount('room-a'), 0);
  });

  it('別の部屋の処理は待たずに並んで動く', async () => {
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await wait(20);
      running -= 1;
    };
    await Promise.all([runSerialized('room-b', task, opts), runSerialized('room-c', task, opts)]);
    assert.equal(maxRunning, 2);
  });

  it('失敗した処理があっても次の処理は動く', async () => {
    const first = runSerialized('room-d', async () => { throw new Error('boom'); }, opts);
    const second = runSerialized('room-d', async () => 'ok', opts);
    await assert.rejects(first, /boom/);
    assert.equal(await second, 'ok');
    assert.equal(queuedCount('room-d'), 0);
  });

  it('待ち行列が上限を超えたら始めずに断る', async () => {
    const small = { ...opts, maxQueue: 2 };
    const a = runSerialized('room-e', () => wait(30), small);
    const b = runSerialized('room-e', () => wait(30), small);
    await assert.rejects(runSerialized('room-e', async () => 'never', small), SubmissionBusyError);
    await Promise.all([a, b]);
    assert.equal(queuedCount('room-e'), 0);
  });

  it('順番を待ちすぎたら始めずに断り、その処理は動かない', async () => {
    let ran = false;
    const slow = runSerialized('room-f', () => wait(100), { ...opts, deadlineMs: 1000 });
    await assert.rejects(
      runSerialized('room-f', async () => { ran = true; }, { ...opts, maxWaitMs: 20 }),
      SubmissionBusyError
    );
    await slow;
    assert.equal(ran, false);
    assert.equal(queuedCount('room-f'), 0);
  });

  it('締め切りを過ぎたら結果不明で返すが、処理は最後まで動き、終わるまで次は始めない', async () => {
    let finished = false;
    let secondStartedAfterFirst = false;
    const first = runSerialized('room-g', async () => { await wait(80); finished = true; }, { ...opts, deadlineMs: 20 });
    const second = runSerialized('room-g', async () => { secondStartedAfterFirst = finished; }, opts);
    await assert.rejects(first, SubmissionDeadlineError);
    assert.equal(finished, false);
    await second;
    assert.equal(finished, true);
    assert.equal(secondStartedAfterFirst, true);
    assert.equal(queuedCount('room-g'), 0);
  });
});
