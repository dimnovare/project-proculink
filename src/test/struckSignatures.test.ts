import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The 2026-08-13 signature audit, made permanent.
 *
 * CLAUDE.md §2 used to open "Do not deviate" and list FIVE non-negotiable
 * spatial signatures. Three of the five were not built. The most expensive one —
 * the edge rails — had a full CSS implementation in globals.css (`.railed`,
 * `.rail`, `.rail-port`, `.rail-label`), four Tailwind tokens, a token entry in
 * every handoff doc, and a rendered demo in showcase.html. It had ZERO
 * consumers, for its entire life. `<CanonicalSpine>` shipped as a real file in
 * src/components/bridge/ with zero importers.
 *
 * Nothing caught either one, and nothing could have: dead CSS is not a type
 * error, an unimported component still compiles, and every guard in this repo
 * scans src/ for what IS there, not docs/ for what is CLAIMED. The delivery
 * vehicle for the defect was a document an agent reads before writing code, so
 * every new screen was designed against a spec the product did not implement.
 *
 * ── WHAT THIS GUARD DOES ─────────────────────────────────────────────────────
 *
 * Three directions, because a one-directional guard is how the same defect comes
 * back rotated:
 *
 *  1. STRUCK STAYS STRUCK — the deleted component, CSS rules and tokens do not
 *     reappear.
 *  2. KEPT STAYS KEPT — the signatures that DID ship are still there. Without
 *     this, direction 1 goes green on an empty repo, and a "cleanup" that
 *     deleted the link-spine gradient or XCard would pass.
 *  3. THE DOCUMENT STILL SAYS THE TRUE THING — CLAUDE.md §2 records the strike
 *     and names what carries buyer/supplier orientation instead. This is the
 *     direction that actually failed last time, and it is the one a src/-only
 *     guard cannot see.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 *
 * It reads source TEXT. It cannot tell whether a rail is being drawn by some
 * other spelling (an inline `style={{ borderLeft: "4px solid #1E66C9" }}` on a
 * page wrapper would pass here), and it does not prove the review panes are
 * ordered correctly on screen — only that the code and the doc still agree about
 * the pieces. Rendering is the visual-baseline suite's job (tests/e2e/visual.spec.ts).
 *
 * This file lives in src/test, which check-tokens.mjs and check-vocabulary.mjs
 * both skip, so it can name the banned strings verbatim.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const GLOBALS_CSS = "src/app/globals.css";
const TAILWIND_CONFIG = "tailwind.config.ts";
const CLAUDE_MD = "CLAUDE.md";

/**
 * CSS is stripped of comments before the rule assertions run. The strike notes
 * left in globals.css and tailwind.config.ts NAME the things they removed —
 * without this, the guard would fail on its own tombstones, and the obvious
 * "fix" would be to delete the explanation of why the rules are gone.
 */
const stripBlockComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripLineComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");

describe("struck signatures stay struck (CLAUDE.md §2, audited 2026-08-13)", () => {
  it("has no CanonicalSpine / SpineNode / EdgeRails component in src/", () => {
    for (const rel of [
      "src/components/bridge/CanonicalSpine.tsx",
      "src/components/bridge/EdgeRails.tsx",
      "src/components/bridge/SpineReview.tsx",
      "src/components/bridge/DocumentAnatomy.tsx",
    ]) {
      expect(existsSync(join(ROOT, rel)), `${rel} was struck — it must not come back`).toBe(false);
    }
  });

  it("defines no edge-rail CSS rule in globals.css", () => {
    const css = stripBlockComments(read(GLOBALS_CSS));
    // Selector position only: `.rail` as a class at the start of a rule. This
    // deliberately does NOT match `--gradient-line-buyer`, `.hiw-rail*` (a
    // marketing progress bar) or the word "rail" in prose.
    const railSelectors = css.match(/^\s*\.rail(ed)?\b[^{]*\{/gm) ?? [];
    expect(railSelectors, "the edge-rail CSS had zero consumers and was deleted").toEqual([]);

    for (const cls of [".rail-port", ".rail-label"]) {
      expect(css.includes(cls), `${cls} was struck with the edge-rail signature`).toBe(false);
    }
  });

  it("defines no rail or spine token in tailwind.config.ts", () => {
    const cfg = stripLineComments(stripBlockComments(read(TAILWIND_CONFIG)));
    for (const token of [
      '"rail"', // spacing — EdgeRails thickness
      '"spine"', // spacing — CanonicalSpine line
      '"rail-buyer"', // backgroundImage
      '"rail-supplier"', // backgroundImage
    ]) {
      expect(cfg.includes(token), `the ${token} token was struck and had zero consumers`).toBe(
        false,
      );
    }
    expect(/^\s*rails:\s*"/m.test(cfg), "the z-rails z-index was struck").toBe(false);
  });

  it("defines no --gradient-rail-* custom property", () => {
    const css = stripBlockComments(read(GLOBALS_CSS));
    expect(css.includes("--gradient-rail-"), "renamed to --gradient-line-buyer").toBe(false);
  });
});

/**
 * ANTI-VACUITY. Every assertion above is an absence, and absences pass on an
 * empty file. These pin the presences, so the suite cannot go green by reading
 * nothing — and they pin the exact pieces a well-meaning "remove the dead
 * bridge-metaphor stuff" sweep would take next.
 */
describe("kept signatures are still real", () => {
  it("still ships the link-spine — it is NOT the deleted canonical spine", () => {
    expect(read(GLOBALS_CSS)).toContain("--gradient-link-spine:");
    expect(read(TAILWIND_CONFIG)).toContain('"link-spine"');
    // It ships as a CSS class on the topbar, not as a <LinkSpine> component.
    // CLAUDE.md §6 claimed `bridge/LinkSpine.tsx` for months; no such file has
    // ever existed. Pin the real carrier so the class cannot go orphan the way
    // the rails did.
    expect(read("src/components/bridge/BridgeTopbar.tsx")).toContain('className="link-spine"');
  });

  it("still ships the monument KPI treatment", () => {
    // Same shape: real CSS, no <MonumentNumber> component.
    expect(read(GLOBALS_CSS)).toContain(".monument");
    expect(read("src/components/bridge/SupplierDockProfile.tsx")).toContain("monument");
  });

  it("still ships XCard and its card-edge token", () => {
    expect(existsSync(join(ROOT, "src/components/bridge/XCard.tsx"))).toBe(true);
    expect(read(TAILWIND_CONFIG)).toContain('"card-edge"');
    expect(read("src/components/bridge/XCard.tsx")).toMatch(/w-card-edge|h-card-edge/);
  });

  it("keeps --gradient-line-buyer defined AND consumed", () => {
    // The one survivor of the rail strike: it draws the vertical connector
    // through a help guide's numbered step badges. Defined-but-unused is exactly
    // the state the whole audit was about, so both halves are pinned.
    expect(read(GLOBALS_CSS)).toContain("--gradient-line-buyer:");
    expect(read("src/components/help/guide/Step.tsx")).toContain("var(--gradient-line-buyer)");
  });

  it("still ships the five-stage journey", () => {
    const journey = read("src/components/bridge/StatusJourney.tsx");
    for (const stage of ["Parse", "Normalize", "Validate", "Transform", "Deliver"]) {
      expect(journey, `stage ${stage} is part of the kept signature`).toContain(stage);
    }
  });
});

/**
 * ORIENTATION. With the rails gone, buyer-left / supplier-right is carried by
 * layout and labels. If these disappear, CLAUDE.md §2 stops being true and there
 * is nothing left telling a user which end of the screen is which.
 */
describe("buyer/supplier orientation has a carrier", () => {
  it("keeps a labelled direction column header in the queue", () => {
    const direction = read("src/hooks/useOrderDirection.ts");
    expect(direction).toContain("Buyer → Supplier");
    expect(direction).toContain("Customer → You");
  });

  it("orders the review panes incoming → outgoing → preview", () => {
    const wb = read("src/components/bridge/mapper/MapperWorkbench.tsx");
    const incoming = wb.indexOf("incomingNode");
    const outgoing = wb.indexOf("outgoingNode");
    const preview = wb.indexOf("previewNode");
    expect(incoming, "MapperWorkbench must still build an incoming pane").toBeGreaterThan(-1);
    expect(outgoing).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(-1);
    // Declaration order is not render order, so this is a weak check by design —
    // it catches a pane being deleted, not a grid being reordered. The visual
    // baselines are what catch a reorder.
    expect(incoming).toBeLessThan(outgoing);
    expect(outgoing).toBeLessThan(preview);
  });

  it("keeps buyer-blue and supplier-green as the direction colours", () => {
    const direction = read("src/hooks/useOrderDirection.ts");
    expect(direction.toLowerCase()).toContain("buyer");
    expect(direction.toLowerCase()).toContain("supplier");
    // The semantics themselves, from the token definitions.
    const css = read(GLOBALS_CSS);
    expect(css).toContain("#1E66C9");
    expect(css).toContain("#2E8E3A");
  });
});

/**
 * THE DOCUMENT. The direction that actually failed. A src/-only guard is blind
 * to it, which is the entire reason the fiction survived for months.
 */
describe("CLAUDE.md §2 describes what ships", () => {
  const claude = read(CLAUDE_MD);

  it("no longer presents five non-negotiable spatial signatures", () => {
    expect(
      /Five spatial signatures \(non-negotiable\)/.test(claude),
      "three of the five were never built — the heading was the defect",
    ).toBe(false);
  });

  it("records the strike for both struck signatures", () => {
    expect(claude).toMatch(/Edge rails[\s\S]{0,400}STRUCK/);
    expect(claude).toMatch(/Canonical Spine review[\s\S]{0,400}DELETED/);
  });

  it("names what carries buyer/supplier orientation instead of the rails", () => {
    expect(claude).toContain("What carries buyer-left / supplier-right now");
    // The three carriers, each named in the doc so a reader does not have to
    // reverse-engineer the orientation from the code.
    expect(claude).toContain("What we received");
    expect(claude).toContain("What we'll send");
    expect(claude).toContain("Buyer → Supplier");
  });

  /**
   * §6 has three tables and only the FIRST is an offer:
   *
   *   ### Signature components                 ← offer: build with these
   *   **…ship as CSS classes, not components** ← clarification: the thing is
   *                                              real, the component is not
   *   **Removed or never built…**              ← tombstones
   *
   * Both assertions below derive their window from these two boundary constants,
   * so neither can drift into reading a tombstone table as if it were the offer.
   */
  const CSS_CLASS_HEADING = "**Two signatures ship as CSS classes, not components.**";
  const REMOVED_HEADING = "**Removed or never built — do not write code against these:**";
  const offeredSection = () => {
    const start = claude.indexOf("### Signature components");
    const cssClasses = claude.indexOf(CSS_CLASS_HEADING);
    const removed = claude.indexOf(REMOVED_HEADING);
    expect(start, "§6 must have a signature-components table").toBeGreaterThan(-1);
    expect(cssClasses, "§6 must keep the CSS-class clarification").toBeGreaterThan(start);
    expect(removed, "§6 must have a removed-components table").toBeGreaterThan(cssClasses);
    return claude.slice(start, cssClasses);
  };

  it("does not offer the struck components as things to build with", () => {
    // §6's table used to offer <EdgeRails> and <CanonicalSpine> with file paths
    // and prop contracts. They may now appear ONLY below the removed heading.
    const offered = offeredSection();
    for (const struck of [
      "<EdgeRails>",
      "<CanonicalSpine>",
      "<DocumentAnatomy>",
      "<DataField>",
      "<LinkSpine>",
      "<MonumentNumber>",
    ]) {
      expect(
        offered.includes(struck),
        `${struck} must not be offered as a component to build with`,
      ).toBe(false);
    }
  });

  it("gives no offered component a path that does not exist", () => {
    // The rails and CanonicalSpine were the loud failures; §6 also carried four
    // quiet ones — <LinkSpine>, <MonumentNumber>, <DocumentAnatomy> and
    // <DataField> — each with a plausible `bridge/Foo.tsx` path and no such file.
    // A path in the offer table is a promise an agent acts on, so each is
    // resolved against the tree. Paths below the removed heading are excluded by
    // construction: naming a deleted file is the whole point of a tombstone.
    const paths = [...offeredSection().matchAll(/`bridge\/([A-Za-z0-9/.]+\.tsx)`/g)].map(
      (m) => m[1],
    );
    expect(paths.length, "§6 must still name component files").toBeGreaterThan(5);

    const missing = paths.filter((p) => !existsSync(join(ROOT, "src/components/bridge", p)));
    expect(missing, "CLAUDE.md offers a component file that is not in the tree").toEqual([]);
  });

  it("flags the handoff-v2 docs as superseded", () => {
    // docs/design-system/handoff-v2/ still contains the struck signatures,
    // including a showcase.html that renders edge rails. An agent that reads it
    // without this warning rebuilds the fiction.
    expect(claude).toContain("docs/design-system/handoff-v2/");
    expect(claude).toMatch(/handoff-v2[\s\S]{0,300}superseded/);
  });
});
