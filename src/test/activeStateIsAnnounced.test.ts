import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A control that looks selected must SAY it is selected.
 *
 * THE DEFECT. Filter strips and tab strips across the app signalled their active
 * item with `background` and `border` and nothing else:
 *
 *     border: `1px solid ${active ? "var(--ink)" : "var(--border)"}`,
 *     background: active ? "var(--ink)" : "var(--surface)",
 *
 * No `aria-pressed`, no `aria-current`, no `aria-selected`. Which filter is
 * applied was a fact available only to someone who could see the fill — WCAG
 * 1.4.1 (Use of Colour) and 4.1.2 (Name, Role, Value).
 *
 * HOW IT WAS FOUND, which is the interesting part. Not by an axe run — axe cannot
 * know that a coloured `<button>` is meant to be a filter. It surfaced as a DEAD
 * CLICK in the three-viewport click pass: pressing an already-active chip changed
 * nothing observable, so the sweep flagged it. Investigating the false positive
 * found the real defect underneath it, and fixing the defect also removes the
 * false positive, because the click pass reads these same attributes to tell
 * "already active" from "wired to nothing".
 *
 * THE COUNT WAS WRONG THE FIRST TIME, and the corrections are baked into the scan
 * below rather than left as a lesson:
 *
 *   • `fileRef.current?.click()` matched a naive `\bcurrent\b\s*\?` — optional
 *     chaining, not a ternary. The pattern now refuses a `?` followed by `.`.
 *   • Controls that ALREADY declare `role="radio"` + `aria-checked` were counted
 *     as missing, because the first exclusion list forgot `aria-checked`.
 *
 * Corrected, the tree has 18 comparable controls that announce state correctly
 * and 6 that did not — so the convention was already the house style and these
 * were the exceptions, which is a very different claim from "the app does not do
 * this".
 *
 * SCOPE. This scans `<button>` opening tags for the SHAPE of the defect: styled
 * on an active flag, silent about it. It cannot prove a control is announced
 * correctly, only that it says something. A control that lies — `aria-pressed`
 * hard-wired to `false` — passes here and is not what this guard is for.
 */

const SRC = join(process.cwd(), "src");

/**
 * Styled on an active-ish flag. The `(?!\.)` is load-bearing: without it,
 * `fileRef.current?.click()` reads as `current ?` and a file-picker button gets
 * reported as an unannounced filter chip.
 */
const STYLED_ON_ACTIVE = /\b(active|isActive|selected|isSelected|current)\b\s*\?(?!\.)/;

/**
 * Any of the ways a control can legitimately announce its state. `aria-checked`
 * and the roles are here because a `role="radio" aria-checked` control is already
 * correct — omitting them is what produced the inflated first count.
 */
const ANNOUNCES_STATE =
  /aria-(pressed|current|selected|checked)|role\s*=\s*["']?\{?["'](radio|tab|option|menuitemradio|combobox)/;

/**
 * Controls whose `selected ?` styles something other than an active state.
 *
 * One entry, and it earns it: SupplierPicker's trigger is a `role="combobox"`
 * whose colour changes by whether a supplier has been CHOSEN — the value, not a
 * pressed state. `aria-pressed` there would assert a toggle that does not exist.
 * Radix supplies `aria-expanded` on the trigger, which is the state that control
 * actually has.
 */
const EXEMPT: Record<string, string> = {
  "src/components/bridge/SupplierPicker.tsx":
    "combobox trigger coloured by whether a value is chosen, not by a pressed state; Radix supplies aria-expanded",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules" && entry !== ".next") out.push(...walk(full));
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `<button …>` opening tag, brace-aware.
 *
 * A naive `<button[^>]*>` ends at the first `>` inside a JSX expression or a
 * quoted aria-label and never reaches the attributes — the failure
 * `check-tokens.mjs` documents and `cardEdgeRule.test.tsx` works around the same
 * way.
 */
export function buttonTags(src: string): { tag: string; line: number; index: number }[] {
  const out: { tag: string; line: number; index: number }[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      i += 1;
    }
    out.push({
      tag: src.slice(m.index, i + 1),
      line: src.slice(0, m.index).split("\n").length,
      index: m.index,
    });
  }
  return out;
}

/**
 * A sort control announces through its HEADER CELL, not through itself.
 *
 * `aria-sort` is only valid on the `th`/`td` with the column role, so a sortable
 * column header is a `<button>` inside a `<th aria-sort>` and the button itself
 * correctly carries no state attribute. Scanning button tags alone reported
 * admin/page.tsx as silent when it had just been fixed the right way — a guard
 * that pushes the fix toward the wrong attribute is worse than no guard.
 *
 * The window is deliberately small: the nearest `<th` in the 400 characters
 * before the button, which covers a header cell whose button is its direct child
 * and does not reach back into an unrelated earlier cell.
 */
function announcedByEnclosingHeaderCell(src: string, buttonIndex: number): boolean {
  const window = src.slice(Math.max(0, buttonIndex - 400), buttonIndex);
  const lastTh = window.lastIndexOf("<th");
  if (lastTh === -1) return false;
  // Nothing may close that cell between it and the button.
  if (window.slice(lastTh).includes("</th>")) return false;
  return /aria-sort/.test(window.slice(lastTh));
}

/**
 * A tag with its comments removed.
 *
 * THE BUG THIS FIXES, caught by mutation testing and not by any of the eight
 * assertions above it. Every fix in this change ships with a comment explaining
 * why the attribute is there, and those comments live INSIDE the opening tag:
 *
 *     <button
 *       key={label}
 *       /* ... `aria-pressed` is the right shape here rather than role=tab ... *\/
 *       aria-pressed={active}
 *
 * `ANNOUNCES_STATE` matched the sentence, not the attribute. Deleting the real
 * `aria-pressed={active}` line left the guard green — it was reading its own
 * documentation as compliance, which is the exact shape `check-tokens` hit
 * counting hex inside comments and `ambientLocale` hit reading its own header.
 *
 * Three guards in this repo have now failed the same way. It is not a coincidence
 * worth explaining away: a source-scan guard must strip comments before it
 * decides anything.
 */
function withoutComments(tag: string): string {
  return tag.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

interface Finding {
  file: string;
  line: number;
  flag: string;
}

function scan(files: string[]): { missing: Finding[]; announcing: Finding[] } {
  const missing: Finding[] = [];
  const announcing: Finding[] = [];
  for (const file of files) {
    const rel = file.replace(process.cwd(), "").replace(/\\/g, "/").replace(/^\//, "");
    const src = readFileSync(file, "utf8");
    for (const { tag, line, index } of buttonTags(src)) {
      const flagged = STYLED_ON_ACTIVE.exec(tag);
      if (!flagged) continue;
      const record = { file: rel, line, flag: flagged[1] };
      const announced =
        ANNOUNCES_STATE.test(withoutComments(tag)) ||
        announcedByEnclosingHeaderCell(src, index) ||
        Boolean(EXEMPT[rel]);
      if (announced) announcing.push(record);
      else missing.push(record);
    }
  }
  return { missing, announcing };
}

describe("a control that looks selected says it is selected", () => {
  const files = walk(SRC);

  it("scans a corpus that is actually there", () => {
    // Anti-vacuity floor: every assertion below passes trivially against an empty
    // walk, and an empty walk looks exactly like a clean bill of health.
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds a real population of controls to check", () => {
    // The second floor, and the one that matters more. A regex that stopped
    // matching anything — a refactor to a shared <Chip>, a rename of `active` —
    // would leave `missing` empty and this guard silently dead.
    const { missing, announcing } = scan(files);
    expect(
      missing.length + announcing.length,
      "no button in the tree styles itself on an active flag any more — this guard is now scanning nothing",
    ).toBeGreaterThan(15);
  });

  it("no active-styled button is silent about its state", () => {
    const { missing } = scan(files);
    const report = missing.map((f) => `  ${f.file}:${f.line}  styled on \`${f.flag}\``).join("\n");
    expect(
      missing,
      missing.length === 0
        ? ""
        : "These buttons change appearance on an active flag but announce nothing, so which one is " +
            "selected is available only to someone who can see the fill (WCAG 1.4.1, 4.1.2). Add " +
            `aria-pressed for a filter/toggle, or aria-checked with a real radiogroup.\n${report}`,
    ).toEqual([]);
  });

  it("recognises every legitimate way to announce state", () => {
    // The negative control. Without this, the test above also passes against an
    // ANNOUNCES_STATE pattern loosened until it matched everything.
    for (const tag of [
      '<button aria-pressed={active} onClick={x}>',
      '<button role="radio" aria-checked={selected}>',
      '<button aria-current="page" className={active ? "on" : "off"}>',
      '<button role="tab" aria-selected={active}>',
    ]) {
      expect(ANNOUNCES_STATE.test(tag), `not recognised as announcing state: ${tag}`).toBe(true);
    }
    expect(ANNOUNCES_STATE.test('<button className={active ? "on" : "off"}>')).toBe(false);
  });

  it("does not mistake optional chaining for a ternary", () => {
    // The exact false positive that inflated the first count from 6 to 13.
    const optionalChain = '<button type="button" onClick={() => fileRef.current?.click()}>';
    expect(
      STYLED_ON_ACTIVE.test(optionalChain),
      "`current?.click()` is being read as a `current ? …` ternary again",
    ).toBe(false);

    const realTernary = '<button style={{ background: active ? "#000" : "#fff" }}>';
    expect(STYLED_ON_ACTIVE.test(realTernary), "the pattern no longer matches a real active ternary").toBe(true);
  });

  it("accepts a sort button announced by its enclosing th", () => {
    // Pinned because the obvious "fix" for this case is to put aria-pressed on
    // the button, which is wrong: aria-sort belongs on the header cell, and a
    // sort control is not a toggle.
    const sortable = [
      '    <th aria-sort={active ? "ascending" : "none"} style={{}}>',
      "      <button onClick={() => toggleSort(col)} style={{ color: active ? \"a\" : \"b\" }}>",
      "        Label",
      "      </button>",
      "    </th>",
    ].join("\n");
    const [only] = buttonTags(sortable);
    expect(STYLED_ON_ACTIVE.test(only.tag), "fixture no longer models the defect shape").toBe(true);
    expect(ANNOUNCES_STATE.test(only.tag), "fixture button should carry no state of its own").toBe(false);
    expect(announcedByEnclosingHeaderCell(sortable, only.index)).toBe(true);
  });

  it("does not credit a th that has already closed", () => {
    // The other direction: a plain button following an unrelated sortable column
    // must not inherit that column's aria-sort.
    const unrelated = [
      '    <th aria-sort="ascending"><button>Sorted</button></th>',
      '    <div><button style={{ background: active ? "x" : "y" }}>Filter</button></div>',
    ].join("\n");
    const tags = buttonTags(unrelated);
    const filter = tags[tags.length - 1];
    expect(announcedByEnclosingHeaderCell(unrelated, filter.index)).toBe(false);
  });

  it("does not read its own explanatory comment as compliance", () => {
    // Caught by mutation testing: deleting the real attribute left the guard
    // green, because the comment ABOVE the attribute says the word "aria-pressed".
    const commentOnly = [
      "<button",
      "  key={label}",
      "  /* aria-pressed is the right shape here rather than role=tab */",
      "  onClick={x}",
      ">",
    ].join("\n");
    expect(
      ANNOUNCES_STATE.test(withoutComments(commentOnly)),
      "a comment mentioning aria-pressed is being counted as the attribute",
    ).toBe(false);

    const withAttribute = commentOnly.replace("  onClick={x}", "  aria-pressed={active}\n  onClick={x}");
    expect(ANNOUNCES_STATE.test(withoutComments(withAttribute))).toBe(true);
  });

  it("reads past a > that sits inside a JSX expression", () => {
    // The brace-aware scan, pinned. A naive regex stops at the first `>` — here,
    // inside the arrow function — and never sees the aria attribute after it,
    // reporting a correctly-announced control as silent.
    const src = '<button onClick={() => setSrc(s)} aria-pressed={active}>Label</button>';
    const [only] = buttonTags(src);
    expect(only.tag).toContain("aria-pressed");
  });
});
