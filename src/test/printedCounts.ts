// PRINTED-COUNT SWEEP — every number a screen prints against a contract label,
// whether or not the markup opted in.
//
// WHY THIS EXISTS. orderCountParity.test.tsx was written for exactly one defect:
// "Ready to send" printed over `ready + ready_to_deliver` on the dashboard while
// meaning `ready` alone everywhere else. It carries a test literally titled
// '"Ready to send" means `ready` only — not `ready + ready_to_deliver`'.
//
// That test was GREEN on 68ed5f2 while the defect was live on the same screen.
// BridgeDashboard's "Ready to send" section head printed `readyRows.length`, and
// `readyRows` was `o.status === "ready" || o.status === "ready_to_deliver"` — the
// removed sum, restored under the removed label, two viewport-inches below the
// stat tile that had been fixed. The guard could not see it because it collected
// counts by walking `[data-count-label]`, and SectionHead's count span carries no
// such attribute.
//
// THE LESSON IS THE MODULE. An opt-in marker means a NEW count is unguarded by
// DEFAULT: the failure mode is not "someone removed a tag", it is "someone wrote
// markup and never knew there was a tag to add". Every count added between WP-29
// and this packet was outside the guard from the moment it was typed.
//
// So the sweep no longer asks the markup to identify itself. It reads the
// rendered DOM the way a person reads the screen: find the label, then read the
// number printed against it.
//
//   ANCHOR      an element whose text IS the label ("Ready to send"), or the
//               label followed by something that is not a word ("Ready to send 5",
//               "Delivered · 11"). The word-boundary rule is load-bearing:
//               "Delivered to supplier" is a different claim, not the "Delivered"
//               count, and useOrderDirection really does render that string.
//   MINIMAL     an element whose DESCENDANT also anchors the label is a container,
//               not the label. Without this every wrapper up to <body> anchors,
//               and a section's number is attributed to the page.
//   NEARBY      the number is read from the anchor's own descendants
//               (`<span>Ready to send <b>5</b></span>` — the proportion-bar legend)
//               or from the anchor's IMMEDIATELY adjacent element siblings
//               (`<h3>Ready to send</h3><span>5</span>` — SectionHead). Adjacency
//               is deliberately immediate rather than "any sibling": a status
//               badge reading "Ready to send" inside an order row sits among
//               unrelated figures, and a wider reach would attribute a line count
//               to a queue count.
//
// The `data-count-label` path is KEPT, not replaced. It is precise where it
// exists, it names labels the DOM text does not spell out, and it is what the
// render-settled `waitFor`s key on. The two sweeps overlap on purpose: where a
// tagged count and an untagged one describe the same label they must agree, and
// that overlap is what caught the section head.
//
// ANTI-VACUITY. A sweep that finds nothing passes everything — which is the
// precise shape of the bug being fixed. Callers must assert corpus floors:
// occurrences found per surface, and at least one occurrence read from an
// element carrying NO `data-count-value`, so the un-attributed path is proven
// live rather than dead code that happens to compile.

export interface PrintedCount {
  /** The contract label the number was printed against. */
  label: string;
  /** The number, parsed from `data-count-value` or from the rendered text. */
  value: number;
  /** How it was found: the markup declared itself, or the DOM was read. */
  via: "attribute" | "adjacency";
  /**
   * Whether the number-bearing element carried `data-count-value`. False means
   * this occurrence is visible ONLY to the adjacency sweep — the case the
   * attribute-only guard was blind to.
   */
  tagged: boolean;
  /** A markup excerpt, so a failure names the element instead of a number. */
  where: string;
}

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * A bare integer, with or without thousands separators — "5", "1,204".
 * Deliberately NOT "+4 more", "62%", "1.5" or "€1,200": those are not a count
 * printed against a label, and crediting them would make conflicts routine and
 * the guard noise.
 */
const BARE_NUMBER_RE = /^\d{1,3}(?:,\d{3})+$|^\d+$/;

export function bareNumber(text: string | null | undefined): number | null {
  const t = norm(text);
  if (!BARE_NUMBER_RE.test(t)) return null;
  return Number(t.replace(/,/g, ""));
}

/**
 * If `text` reads as this label, the remainder after it; otherwise null.
 *
 * "" (the label alone) and "5" / "· 11" (label then a figure) both anchor.
 * "to supplier" does not — a letter after the label means the words continue
 * into a different phrase. That is not hypothetical: `useOrderDirection` ships
 * `deliveredLabel: "Delivered to supplier"`, which without this rule would
 * anchor the "Delivered" contract count onto whatever number sat beside it.
 */
export function labelRemainder(text: string | null | undefined, label: string): string | null {
  const t = norm(text);
  if (!t.startsWith(label)) return null;
  const rest = t.slice(label.length).replace(/^\s+/, "");
  if (rest !== "" && /^[A-Za-z]/.test(rest)) return null;
  return rest;
}

function excerpt(el: Element): string {
  const html = el.outerHTML.replace(/\s+/g, " ");
  return html.length > 200 ? `${html.slice(0, 197)}…` : html;
}

/**
 * The MINIMAL elements that anchor `label` — every element reading as the label
 * whose descendants do not also read as it.
 */
export function anchorsFor(root: ParentNode, label: string): Element[] {
  const all = Array.from(root.querySelectorAll("*")).filter(
    (el) => labelRemainder(el.textContent, label) !== null,
  );
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

/** Bare-integer elements inside the anchor, or immediately beside it. */
function numbersNear(anchor: Element): { value: number; el: Element }[] {
  const out: { value: number; el: Element }[] = [];
  const seen = new Set<Element>();
  const push = (el: Element | null | undefined) => {
    if (!el || seen.has(el)) return;
    const n = bareNumber(el.textContent);
    if (n === null) return;
    seen.add(el);
    out.push({ value: n, el });
  };
  for (const d of Array.from(anchor.querySelectorAll("*"))) push(d);
  push(anchor.previousElementSibling);
  push(anchor.nextElementSibling);
  return out;
}

/**
 * Every count `container` printed against one of `labels`.
 *
 * Throws — rather than returning a partial answer — on a `data-count-label` with
 * no parseable `data-count-value`, because a tag that carries no number is a tag
 * that silently drops a count out of the corpus.
 */
export function collectPrintedCounts(
  container: ParentNode,
  labels: readonly string[],
): PrintedCount[] {
  const found: PrintedCount[] = [];

  // 1 — counts the markup declares. Precise, and the only way to read a label
  //     the rendered text does not spell out.
  for (const el of Array.from(container.querySelectorAll("[data-count-label]"))) {
    const label = (el as HTMLElement).dataset.countLabel!;
    const raw = (el as HTMLElement).dataset.countValue;
    if (raw === undefined) {
      throw new Error(`[data-count-label="${label}"] must also carry data-count-value: ${excerpt(el)}`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`data-count-value for "${label}" must be a number, got "${raw}": ${excerpt(el)}`);
    }
    found.push({ label, value, via: "attribute", tagged: true, where: excerpt(el) });
  }

  // 2 — counts the markup merely PRINTS. No opt-in, so a count added without
  //     knowing this guard exists is still inside it.
  for (const label of labels) {
    for (const anchor of anchorsFor(container, label)) {
      for (const { value, el } of numbersNear(anchor)) {
        found.push({
          label,
          value,
          via: "adjacency",
          tagged: el.hasAttribute("data-count-value"),
          where: excerpt(anchor.parentElement ?? anchor),
        });
      }
    }
  }

  return found;
}
