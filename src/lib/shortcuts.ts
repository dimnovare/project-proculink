// The one list of keyboard shortcuts. The shortcuts list draws it, `useShortcut` wires it, and
// src/test/shortcutRegistry.test.ts keeps registered, wired and drawn equal.
//
// Never taken (plan 14.10 R11), because the browser or a screen reader owns them: Ctrl+L, Ctrl+E,
// Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Tab, Ctrl+F, Ctrl+G, Ctrl+P, Ctrl+S, Ctrl+D, Ctrl+R, Ctrl+H, Ctrl+J,
// Ctrl+O, Ctrl+U, Ctrl+plus/minus/0, F1 to F12, every Ctrl+Shift chord, Alt+arrows, Space,
// Page Up/Down, Home, End, Escape (owned by whatever is open), Tab and Shift+Tab (left to the
// browser); Insert and Caps Lock combinations (NVDA, JAWS, Narrator), Ctrl+Option combinations
// (VoiceOver), Ctrl alone, and single letters (browse-mode quick keys). Ctrl+K is the one browser
// shortcut taken over (spec decision 3).

export type ShortcutId = "search" | "send-and-next" | "next-value" | "show-shortcuts";

export interface Shortcut {
  id: ShortcutId;
  /** Key chips as drawn, in order. "Mod" is drawn as "Ctrl", or "Cmd" on Apple platforms. */
  keys: readonly string[];
  /** What it does, as the list says it. */
  words: string;
  /** The one file that wires it with useShortcut (or, for a native key, the screen it describes). */
  where: string;
  /** The aria-keyshortcuts value the control that does the same carries; null for none. */
  aria: string | null;
  /** The browser does it; drawn, never wired. */
  native?: true;
  /** One key, no modifier: obeys the off switch (WCAG 2.1.4). */
  single?: true;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "search", keys: ["Mod", "K"], words: "Search", where: "src/components/bridge/BridgeTopbar.tsx", aria: "Control+K Meta+K" },
  { id: "send-and-next", keys: ["Mod", "Enter"], words: "Send and open next", where: "src/components/flows/DocumentScreen.tsx", aria: "Control+Enter Meta+Enter" },
  { id: "next-value", keys: ["Tab"], words: "Next value to check", where: "src/components/flows/DocumentScreen.tsx", aria: null, native: true },
  { id: "show-shortcuts", keys: ["?"], words: "Show shortcuts", where: "src/components/bridge/BridgeTopbar.tsx", aria: null, single: true },
];

/** The aria-keyshortcuts value for a shortcut's control. */
export const ariaOf = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.aria ?? undefined;

export const SINGLE_KEYS_KEY = "plk:single-key-shortcuts";
export const SINGLE_KEYS_EVENT = "plk:single-keys";
export const OPEN_SEARCH_EVENT = "plk:open-search";

const BLOCKED = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

function typedInto(el: Element): boolean {
  return el.matches("input, textarea, select")
    || (el as HTMLElement).isContentEditable === true
    || !!el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
}

/** The key of a chord, lower case; a non-Latin letter is read from the key's place (KeyK is k). */
function chordKey(e: KeyboardEvent): string {
  const k = e.key.toLowerCase();
  if (k.length === 1 && !/[a-z]/.test(k)) {
    const m = /^Key([A-Z])$/.exec(e.code);
    if (m) return m[1].toLowerCase();
  }
  return k;
}

/** The registered shortcut this key press is, or null. Rules in R9 and R10. */
export function matchShortcut(e: KeyboardEvent, apple: boolean): ShortcutId | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat || e.altKey || e.getModifierState?.("AltGraph")) return null;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(BLOCKED)) return null;
  // A modal open anywhere owns the keyboard, wherever the focus happens to be.
  if (typeof document !== "undefined" && document.querySelector('[aria-modal="true"], [role="alertdialog"]')) return null;
  const mod = apple ? e.metaKey : e.ctrlKey;
  const other = apple ? e.ctrlKey : e.metaKey;
  for (const s of SHORTCUTS) {
    if (s.native) continue;
    if (s.keys[0] === "Mod") {
      if (mod && !other && !e.shiftKey && chordKey(e) === s.keys[1].toLowerCase()) return s.id;
    } else if (!e.ctrlKey && !e.metaKey && e.key === s.keys[0] && !(target && typedInto(target))) {
      return s.id;
    }
  }
  return null;
}

/** Whether one-key shortcuts are on in this browser. Unreadable storage counts as on. */
export function singleKeysOn(): boolean {
  try {
    return window.localStorage.getItem(SINGLE_KEYS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSingleKeys(on: boolean): void {
  try {
    window.localStorage.setItem(SINGLE_KEYS_KEY, on ? "on" : "off");
  } catch {
    // storage blocked: the switch lasts as long as nothing reads it again
  }
  window.dispatchEvent(new Event(SINGLE_KEYS_EVENT));
}

export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform ?? "");
}

/** "Ctrl"/"Cmd" for "Mod", otherwise the key as drawn. */
export function keyWord(key: string, apple: boolean): string {
  return key === "Mod" ? (apple ? "Cmd" : "Ctrl") : key;
}

export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
