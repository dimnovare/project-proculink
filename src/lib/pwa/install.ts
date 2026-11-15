import { useSyncExternalStore } from "react";

/**
 * The install offer. The browser's own prompt is caught at page load and shown only
 * when the person presses "Install ProcuLink" in Settings — never as a pop-up.
 */
export type InstallState = "unknown" | "app" | "installed" | "dismissed" | "prompt" | "iphone" | "manual";
export const INSTALL_DISMISSED_KEY = "plk:install-dismissed";

type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let stashed: PromptEvent | null = null;
let installed = false;
let dismissed = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    stashed = e as PromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    stashed = null;
    notify();
  });
}

/** Pure. The first that holds wins: app > installed > dismissed > prompt > iphone > manual. */
export function deriveInstallState(f: { standalone: boolean; ios: boolean; hasPrompt: boolean; installed: boolean; dismissed: boolean }): Exclude<InstallState, "unknown"> {
  if (f.standalone) return "app";
  if (f.installed) return "installed";
  if (f.dismissed) return "dismissed";
  if (f.hasPrompt) return "prompt";
  return f.ios ? "iphone" : "manual";
}

/** iPhone, iPod, iPad, or an iPad that reports itself as a Mac with touch. */
export function isIos(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}

const STANDALONE = "(display-mode: standalone)";

function readDismissed(): boolean {
  try {
    return dismissed || localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return dismissed;
  }
}

function snapshot(): InstallState {
  return deriveInstallState({
    standalone: window.matchMedia(STANDALONE).matches || (navigator as { standalone?: boolean }).standalone === true,
    ios: isIos(navigator),
    hasPrompt: stashed !== null,
    installed,
    dismissed: readDismissed(),
  });
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  const media = window.matchMedia(STANDALONE);
  media.addEventListener?.("change", fn);
  return () => {
    subscribers.delete(fn);
    media.removeEventListener?.("change", fn);
  };
}

/** What the page knows about installing; "unknown" on the server and before hydration. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, snapshot, () => "unknown");
}

/** Shows the stashed prompt. A refusal is remembered on this device. Null when the browser offered nothing. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const event = stashed;
  if (!event) return null;
  stashed = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "dismissed") {
    dismissed = true;
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Storage may be blocked; the refusal is still kept for this visit.
    }
  }
  notify();
  return outcome;
}
