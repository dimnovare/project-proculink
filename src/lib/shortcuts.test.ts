import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { matchShortcut, keyWord, singleKeysOn, setSingleKeys, SINGLE_KEYS_KEY, type ShortcutId } from "./shortcuts";
import { useShortcut } from "@/hooks/useShortcut";

type Init = KeyboardEventInit & { keyCode?: number };

/** Dispatches a real keydown on `on` and returns what a window listener matched. */
function press(on: EventTarget, init: Init, apple = false): ShortcutId | null {
  let got: ShortcutId | null | undefined;
  const listen = (e: KeyboardEvent) => { got = matchShortcut(e, apple); };
  window.addEventListener("keydown", listen);
  const e = new KeyboardEvent("keydown", { bubbles: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(e, "keyCode", { value: init.keyCode });
  on.dispatchEvent(e);
  window.removeEventListener("keydown", listen);
  return got as ShortcutId | null;
}

function add<K extends keyof HTMLElementTagNameMap>(tag: K, into: HTMLElement = document.body) {
  return into.appendChild(document.createElement(tag));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

const ctrlK = { key: "k", code: "KeyK", ctrlKey: true };

describe("shortcuts", () => {
  it("a chord fires from a value box, a single key never does, and nothing fires with Alt, while composing, on a repeat or inside a dialog", () => {
    const input = add("input");
    expect(press(input, { key: "Enter", code: "Enter", ctrlKey: true })).toBe("send-and-next");
    expect(press(input, ctrlK)).toBe("search");
    expect(press(input, { key: "?", code: "Slash", shiftKey: true })).toBeNull();
    expect(press(document.body, { key: "?", code: "Slash", shiftKey: true })).toBe("show-shortcuts");
    expect(press(add("select"), { key: "?", shiftKey: true })).toBeNull();
    const editable = add("div");
    editable.setAttribute("contenteditable", "true");
    expect(press(editable, { key: "?", shiftKey: true })).toBeNull();
    expect(press(document.body, { ...ctrlK, altKey: true })).toBeNull();
    expect(press(document.body, { ...ctrlK, shiftKey: true })).toBeNull();
    expect(press(document.body, { ...ctrlK, repeat: true })).toBeNull();
    expect(press(document.body, { ...ctrlK, isComposing: true })).toBeNull();
    expect(press(document.body, { ...ctrlK, keyCode: 229 })).toBeNull();
    expect(press(document.body, { key: "л", code: "KeyK", ctrlKey: true })).toBe("search");
    const dialog = add("div");
    dialog.setAttribute("role", "dialog");
    expect(press(add("button", dialog), ctrlK)).toBeNull();
    expect(press(document.body, { key: "Tab", code: "Tab" })).toBeNull();
  });

  it("Cmd is the chord key on a Mac and Ctrl everywhere else, and the words follow", () => {
    const metaK = { key: "k", code: "KeyK", metaKey: true };
    expect(press(document.body, metaK, true)).toBe("search");
    expect(press(document.body, ctrlK, true)).toBeNull();
    expect(press(document.body, ctrlK, false)).toBe("search");
    expect(press(document.body, metaK, false)).toBeNull();
    expect(keyWord("Mod", true)).toBe("Cmd");
    expect(keyWord("Mod", false)).toBe("Ctrl");
    expect(keyWord("Enter", true)).toBe("Enter");
  });

  it("the ? key obeys its switch, which survives a reload and a storage that throws", () => {
    expect(singleKeysOn()).toBe(true);
    setSingleKeys(false);
    expect(singleKeysOn()).toBe(false);
    expect(localStorage.getItem(SINGLE_KEYS_KEY)).toBe("off");

    const run = vi.fn();
    renderHook(() => useShortcut("show-shortcuts", run));
    const question = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true }));
    question();
    expect(run).not.toHaveBeenCalled();
    setSingleKeys(true);
    question();
    expect(run).toHaveBeenCalledTimes(1);

    setSingleKeys(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(singleKeysOn()).toBe(true);
  });
});
