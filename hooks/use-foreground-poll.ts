'use client';

import { useEffect, useRef, useState } from 'react';

/** Serial requests, visibility/network suspension, cancellation and bounded backoff. */
export function useForegroundPoll(task: (signal: AbortSignal) => Promise<void>, intervalMs: number, enabled = true, identity = '') {
  const callback = useRef(task);
  useEffect(() => { callback.current = task; }, [task]);
  const [paused, setPaused] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    let failures = 0;
    let resumePending = false;
    const active = () => document.visibilityState !== 'hidden' && navigator.onLine;
    async function run() {
      clearTimeout(timer);
      if (disposed) return;
      if (!active()) { setPaused(true); return; }
      if (inFlight) { resumePending = true; return; }
      setPaused(false); inFlight = true; resumePending = false;
      const request = new AbortController(); controller = request;
      try { await callback.current(request.signal); failures = 0; }
      catch { if (!request.signal.aborted) failures += 1; }
      finally {
        inFlight = false;
        if (!disposed && active()) timer = setTimeout(run, resumePending ? 0 : failures ? Math.min(30000, intervalMs * 2 ** failures) : intervalMs);
      }
    }
    function changed() {
      clearTimeout(timer);
      if (!active()) { setPaused(true); controller?.abort(); }
      else { failures = 0; void run(); }
    }
    void run();
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('online', changed); window.removeEventListener('offline', changed);
    };
  }, [intervalMs, enabled, identity, revision]);
  return { paused, refresh: () => setRevision((value) => value + 1) };
}
