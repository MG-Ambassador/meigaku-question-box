/**
 * 質問投稿の部屋ごとの順番待ち（1プロセス内）と打ち切り。
 *
 * 投稿のたびに部屋の集計ドキュメント eventStats/<部屋ID> をトランザクションで読み書きするため、
 * 同じ部屋への投稿が同時に重なると Firestore のロック待ち・中断・再試行が連鎖し、
 * 全員が長く待たされたうえで失敗する（負荷試験で確認、説明書 6.2）。
 * そこで同じ部屋への投稿は1プロセス内で1件ずつ順に処理し、Firestore で競合するのを
 * 「同時に動いているインスタンス数」までに抑える。
 *
 * - 待ち行列が長すぎる／待ち時間が長すぎるときは処理を始めずに断る（SubmissionBusyError）。
 *   この場合は保存されていないことが確実。
 * - 始めた処理が締め切りまでに終わらないときは結果不明として返す（SubmissionDeadlineError）。
 *   処理自体は裏で続き、保存されることもある。同じ requestId で再送すれば重複しない。
 */

export class SubmissionBusyError extends Error {
  constructor() {
    super('SUBMISSION_BUSY');
    this.name = 'SubmissionBusyError';
  }
}

export class SubmissionDeadlineError extends Error {
  constructor() {
    super('SUBMISSION_DEADLINE');
    this.name = 'SubmissionDeadlineError';
  }
}

export interface SubmissionQueueOptions {
  /** 1つの部屋で同時に待てる件数（処理中を含む） */
  maxQueue: number;
  /** 順番が来るまで待つ上限（ミリ秒） */
  maxWaitMs: number;
  /** 受け付けてから応答するまでの上限（ミリ秒）。Cloud Run のタイムアウト 10秒より短くする */
  deadlineMs: number;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getSubmissionQueueOptions(): SubmissionQueueOptions {
  return {
    maxQueue: readPositiveInt('SUBMISSION_QUEUE_MAX', 200),
    maxWaitMs: readPositiveInt('SUBMISSION_QUEUE_WAIT_MS', 5000),
    deadlineMs: readPositiveInt('SUBMISSION_DEADLINE_MS', 8000),
  };
}

interface Lane {
  tail: Promise<void>;
  size: number;
}

const lanes = new Map<string, Lane>();

/** テスト用：今その部屋で待っている（処理中を含む）件数 */
export function queuedCount(key: string): number {
  return lanes.get(key)?.size ?? 0;
}

function timer(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let handle: NodeJS.Timeout | undefined;
  const promise = new Promise<'timeout'>((resolve) => {
    handle = setTimeout(() => resolve('timeout'), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * 同じ key の処理を1件ずつ順に実行する。
 * 待ちが長すぎれば SubmissionBusyError、締め切りを過ぎれば SubmissionDeadlineError を投げる。
 * 締め切りで応答を返しても、始まった処理が終わるまで次の処理は始めない（競合させないため）。
 */
export async function runSerialized<T>(
  key: string,
  task: () => Promise<T>,
  options: SubmissionQueueOptions = getSubmissionQueueOptions()
): Promise<T> {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), size: 0 };
    lanes.set(key, lane);
  }
  if (lane.size >= options.maxQueue) {
    throw new SubmissionBusyError();
  }

  const currentLane = lane;
  currentLane.size += 1;
  const previous = currentLane.tail;
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  currentLane.tail = previous.then(() => mine);

  const done = () => {
    release();
    currentLane.size -= 1;
    if (currentLane.size === 0 && lanes.get(key) === currentLane) {
      lanes.delete(key);
    }
  };

  const startedAt = Date.now();

  // 1. 順番を待つ（待ちすぎたら始めずに断る）
  const waitTimer = timer(options.maxWaitMs);
  const turn = await Promise.race([previous.then(() => 'ready' as const), waitTimer.promise]);
  waitTimer.cancel();
  if (turn === 'timeout') {
    done();
    throw new SubmissionBusyError();
  }

  // 2. 処理する（締め切りを過ぎたら応答だけ先に返す。順番は処理が終わるまで手放さない）
  const work = task();
  work.then(done, done);

  const remaining = Math.max(1, options.deadlineMs - (Date.now() - startedAt));
  const deadlineTimer = timer(remaining);
  try {
    const outcome = await Promise.race([
      work.then((value) => ({ kind: 'done' as const, value })),
      deadlineTimer.promise,
    ]);
    if (outcome === 'timeout') {
      // 裏で続く処理の失敗が未処理の例外にならないようにする
      work.catch(() => undefined);
      throw new SubmissionDeadlineError();
    }
    return outcome.value;
  } finally {
    deadlineTimer.cancel();
  }
}
