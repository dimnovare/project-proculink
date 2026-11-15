"use client";

import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/pwa/online";

/**
 * The one "may be out of date" line for every app list at once. Always present as a
 * status region so it is announced when it fills; empty unless the browser is offline.
 */
export function OfflineNotice() {
  const offline = useOnline() === false;
  return (
    <div
      role="status"
      data-testid="offline-notice"
      className={offline ? "flex min-h-[38px] items-center gap-2 bg-amber-soft px-4 text-[13.5px] font-semibold text-amber-text" : undefined}
    >
      {offline && (
        <>
          <WifiOff aria-hidden size={16} />
          You&apos;re offline. Showing what was loaded last.
        </>
      )}
    </div>
  );
}
