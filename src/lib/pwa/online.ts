import { useSyncExternalStore } from "react";

/** A plain read for code outside React. True when navigator is absent (server, old tests). */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function subscribe(fn: () => void): () => void {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

/** navigator.onLine, kept current by the "online"/"offline" events. Null on the server: not known yet. */
export function useOnline(): boolean | null {
  return useSyncExternalStore(subscribe, isOnline, () => null);
}
