"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { SHORTCUTS, isApple, matchShortcut, singleKeysOn, type ShortcutId } from "@/lib/shortcuts";

/** Runs `run` when the registered shortcut is pressed anywhere in the window and `enabled` is true.
 *  Calls preventDefault on a match. Reads `run` through a ref, so it need not be memoised. A `single`
 *  shortcut checks singleKeysOn() at the moment of the press. A `native` id throws (it must not be wired). */
export function useShortcut(id: ShortcutId, run: () => void, enabled = true): void {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut || shortcut.native) throw new Error(`The shortcut "${id}" is the browser's own and is never wired.`);
  const single = !!shortcut.single;
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    const apple = isApple();
    // Bubble phase on window: a component that handles the key itself and calls preventDefault wins.
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(e, apple) !== id || (single && !singleKeysOn())) return;
      e.preventDefault();
      runRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, enabled, single]);
}

const noSubscribe = () => () => {};

/** false on the server and during hydration, then isApple(). */
export function useApple(): boolean {
  return useSyncExternalStore(noSubscribe, isApple, () => false);
}
