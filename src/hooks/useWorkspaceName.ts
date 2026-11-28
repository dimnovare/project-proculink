import { useEffect, useState } from "react";
import { useOrganization } from "@clerk/nextjs";

// A language change reloads the page (src/i18n/locales.ts), and for the moment before Clerk loads again the
// header said "Your workspace" and the avatar "…". The last known values are kept for the tab and shown until
// the live ones arrive. Read after mount, so the server render and the first client render agree.
const WORKSPACE = "plk:workspace-name";
const INITIALS = "plk:user-initials";

export function remember(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the live value still shows once Clerk loads.
  }
}

/** `live` while it is known (and kept for the tab), else the value kept last, else null. */
export function useRemembered(key: string, live: string | null | undefined): string | null {
  const [kept, setKept] = useState<string | null>(null);
  useEffect(() => {
    if (live) return remember(key, live);
    try {
      setKept(sessionStorage.getItem(key));
    } catch {
      // Storage blocked: nothing kept.
    }
  }, [key, live]);
  return live || kept;
}

export const rememberWorkspaceName = (name: string | null) => remember(WORKSPACE, name);
export const useRememberedInitials = (live: string | null) => useRemembered(INITIALS, live);

/** Forget both at sign-out, so the next person on this tab never sees them. */
export function forgetWorkspace() {
  remember(WORKSPACE, null);
  remember(INITIALS, null);
}

export function useWorkspaceName(fallback: string): string {
  const { organization } = useOrganization();
  return useRemembered(WORKSPACE, organization?.name) ?? fallback;
}
