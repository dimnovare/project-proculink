// Registered, wired and drawn stay equal (plan 14.10, Task 2). The registry is src/lib/shortcuts.ts;
// the wiring is every `useShortcut("<id>"` in the source; the drawing is ShortcutsSheet; and every
// control that announces a shortcut (`aria-keyshortcuts`) announces a registered one. The source is
// read with comments stripped, so a call or an attribute that exists only in a comment counts for
// nothing.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, within, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./sourceScan";
import { SHORTCUTS, keyWord, type ShortcutId } from "@/lib/shortcuts";
import { ShortcutsSheet } from "@/components/bridge/ShortcutsSheet";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const HOOK_FILE = "src/hooks/useShortcut.ts";

/** Every shipped .ts/.tsx file under src/ (tests describe shortcuts, they do not wire them), comments stripped. */
function sources(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      out.push({ rel: relative(ROOT, full).split(sep).join("/"), code: stripComments(readFileSync(full, "utf8")) });
    }
  };
  walk(SRC);
  return out;
}

// R11: the browser's and the screen readers' own keys. `mod` is Ctrl (Cmd on a Mac). Ctrl+Shift and
// Alt chords are refused by the matcher itself and cannot be registered (asserted below).
const F_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);
const RESERVED: { mod: boolean; key: string }[] = [
  ..."K L E T W N F G P S D R H J O U + - = 0".split(" ").map((key) => ({ mod: true, key })),
  ...["Tab", ...F_KEYS].map((key) => ({ mod: true, key })),
  ...[" ", "Space", "PageUp", "PageDown", "Home", "End", "Escape", "Tab", ...F_KEYS].map((key) => ({ mod: false, key })),
];
// Spec decision 3: Ctrl/Cmd K opens search. It is the one browser shortcut taken over.
const ALLOWED_OVERRIDE: ShortcutId[] = ["search"];

describe("shortcut registry", () => {
  it("every shortcut that is not the browser's is wired once, in the file the registry names, and nothing wires an unregistered one", () => {
    const calls: { id: string; rel: string }[] = [];
    const dynamic: string[] = [];
    for (const { rel, code } of sources()) {
      for (const m of code.matchAll(/\buseShortcut\(\s*"([^"]*)"/g)) calls.push({ id: m[1], rel });
      // A call the guard cannot read would make it blind: every call names its id as a literal.
      if (rel !== HOOK_FILE && /\buseShortcut\(\s*[^"\s]/.test(code)) dynamic.push(rel);
    }
    expect(calls.length, "found too few useShortcut calls: the scan is not reading the source").toBeGreaterThanOrEqual(3);
    expect(dynamic, "useShortcut called with an id that is not a string literal").toEqual([]);

    const wired = [...new Set(calls.map((c) => c.id))].sort();
    expect(wired).toEqual(SHORTCUTS.filter((s) => !s.native).map((s) => s.id).sort());
    for (const s of SHORTCUTS.filter((x) => !x.native))
      expect(calls.filter((c) => c.id === s.id).map((c) => c.rel), `${s.id} is wired once, in ${s.where}`).toEqual([s.where]);
    expect(calls.filter((c) => c.id === "next-value")).toEqual([]);

    const taken = SHORTCUTS.filter((s) => !s.native).map((s) => {
      const mod = s.keys[0] === "Mod";
      const rest = mod ? s.keys.slice(1) : s.keys;
      expect(rest, `${s.id}: one key after the chord key, never Shift or Alt`).toHaveLength(1);
      expect(rest[0]).not.toMatch(/^(Shift|Alt|Control|Meta|Mod)$/);
      // A single letter is a screen reader's browse-mode quick key.
      if (!mod) expect(rest[0], `${s.id} is a single letter`).not.toMatch(/^[a-z]$/i);
      return { id: s.id, mod, key: rest[0] };
    });
    const overrides = taken.filter((t) => RESERVED.some((r) => r.mod === t.mod && r.key.toLowerCase() === t.key.toLowerCase()));
    expect(overrides.map((t) => t.id)).toEqual(ALLOWED_OVERRIDE);
  });

  it("the list draws every registered shortcut, and every control that announces a shortcut announces a registered one", () => {
    render(createElement(ShortcutsSheet, { onClose: vi.fn() }));
    const region = screen.getByRole("region", { name: "Keyboard shortcuts" });
    const rows = within(region).getAllByRole("definition").map((dd) => dd.parentElement!);
    expect(rows.map((r) => within(r).getByRole("definition").textContent)).toEqual(SHORTCUTS.map((s) => s.words));
    rows.forEach((r, i) =>
      expect([...r.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(SHORTCUTS[i].keys.map((k) => keyWord(k, false))));

    const ariaById = (id: string) => SHORTCUTS.find((s) => s.id === id)?.aria ?? `unregistered id "${id}"`;
    const announced: { rel: string; value: string }[] = [];
    const unreadable: string[] = [];
    const FORMS =
      /^(?:"([^"]*)"|\{\s*"([^"]*)"\s*\}|\{\s*ariaOf\(\s*"([^"]+)"\s*\)\s*\}|\{\s*SHORTCUTS\.find\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\4\.id\s*===\s*"([^"]+)"\s*\)!?\.aria!?\s*\})/;
    for (const { rel, code } of sources()) {
      for (const m of code.matchAll(/aria-keyshortcuts=/g)) {
        const f = FORMS.exec(code.slice(m.index! + m[0].length));
        if (!f) { unreadable.push(rel); continue; }
        announced.push({ rel, value: f[1] ?? f[2] ?? ariaById(f[3] ?? f[5]) });
      }
    }
    expect(unreadable, "aria-keyshortcuts written in a form this guard cannot read").toEqual([]);
    expect(announced.length, "found too few aria-keyshortcuts: the scan is not reading the source").toBeGreaterThanOrEqual(2);
    const registered = SHORTCUTS.map((s) => s.aria).filter(Boolean);
    for (const a of announced) expect(registered, `${a.rel} announces "${a.value}"`).toContain(a.value);
    for (const s of SHORTCUTS.filter((x) => x.aria))
      expect(announced.some((a) => a.rel === s.where && a.value === s.aria), `${s.where} announces ${s.id}`).toBe(true);
  });
});
