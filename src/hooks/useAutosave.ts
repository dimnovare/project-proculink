"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "saving" | "failed";

type Waiter = { resolve: () => void; reject: (e: unknown) => void };

/** Keeps the newest value and saves it: after `delayMs` without a change, or at once on `change(v, true)` / `flush()`.
 *  At most one `save` runs at a time; changes made meanwhile are sent next, newest only. A failure keeps the value
 *  and waits for the next change or `flush()`. While anything is unsaved, `beforeunload` asks before the tab closes;
 *  a value still waiting when the component unmounts is sent once, without waiting for the answer. */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delayMs = 800) {
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<unknown>(null);
  // Mutable engine: the waiting value, whether a save is on its way, whether the waiting value is due now,
  // and the flush() waiters for the waiting value and for the save on its way.
  const s = useRef({
    save,
    pending: null as { value: T } | null,
    running: false,
    due: false,
    alive: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    waiting: [] as Waiter[],
    onTheWay: [] as Waiter[],
  });
  useEffect(() => { s.current.save = save; }, [save]);

  const run = useCallback(() => {
    const e = s.current;
    clearTimeout(e.timer);
    e.timer = undefined;
    if (e.running || !e.pending) return;
    const { value } = e.pending;
    e.pending = null;
    e.due = false;
    e.onTheWay = e.waiting;
    e.waiting = [];
    e.running = true;
    const settle = (err?: unknown, failed = false) => {
      e.running = false;
      const waiters = e.onTheWay;
      e.onTheWay = [];
      waiters.forEach((w) => (failed ? w.reject(err) : w.resolve()));
      if (!e.alive) { if (e.pending) run(); return; }   // unmounted: send the waiting value once, no state
      if (failed) setError(err); else setError(null);
      if (e.pending) { if (e.due) run(); return; }       // a newer value waits; its timer or `now` sends it
      if (failed) { e.pending = { value }; setState("failed"); } else setState("saved");
    };
    e.save(value).then(() => settle(), (err: unknown) => settle(err, true));
  }, []);

  const change = useCallback((value: T, now = false) => {
    const e = s.current;
    e.pending = { value };
    setState("saving");
    if (now) { e.due = true; run(); return; }
    clearTimeout(e.timer);
    e.timer = setTimeout(() => { e.due = true; run(); }, delayMs);
  }, [run, delayMs]);

  const flush = useCallback(() => {
    const e = s.current;
    if (!e.pending && !e.running) return Promise.resolve();
    const done = new Promise<void>((resolve, reject) => {
      (e.pending ? e.waiting : e.onTheWay).push({ resolve, reject });
      if (e.pending) { e.due = true; setState("saving"); run(); }
    });
    // A caller that does not await still sees the failure in `state`; one that awaits gets the rejection.
    done.catch(() => {});
    return done;
  }, [run]);

  /** Drops the waiting value and its timer without sending it; its `flush()` waiters resolve. A save on its way
   *  is not stopped. `state` is left as it is: a caller that still needs the dropped value sends it again with
   *  `change`. Returns whether a value was dropped. */
  const discard = useCallback(() => {
    const e = s.current;
    clearTimeout(e.timer);
    e.timer = undefined;
    const dropped = e.pending !== null;
    e.pending = null;
    e.due = false;
    e.waiting.splice(0).forEach((w) => w.resolve());
    return dropped;
  }, []);

  useEffect(() => {
    if (state === "saved") return;
    const ask = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [state]);

  useEffect(() => {
    const e = s.current;
    e.alive = true;
    return () => {
      e.alive = false;
      clearTimeout(e.timer);
      e.timer = undefined;
      run();   // sends a waiting value now, or after the save on its way settles
    };
  }, [run]);

  return { state, error, change, flush, discard };
}
