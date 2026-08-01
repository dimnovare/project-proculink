// ─────────────────────────────────────────────────────────────────────────────
// routeQueryParams — which query parameters each route actually CONSUMES.
//
// WP-24 shipped a recovery panel whose whole promise is that every failure state
// carries a control whose destination does the thing the label says. The link
// gates we already had cannot check that promise, because all of them normalise
// a href through `appRoutes.normalizePath`, which strips `?` before matching:
//
//     export function normalizePath(href: string): string {
//       const path = href.split("#")[0].split("?")[0];   // ← the query is gone
//
// So `/inbox/ord-1?details=response` "resolves to a live page" — the PAGE is
// live — while `details` is read by nothing anywhere in the app. The panel is a
// banner already rendered at `/inbox/ord-1`, so "See their reply" navigated the
// operator to the screen they were already on and changed nothing. A dead end
// that every existing gate scored green, and `problemContract.test.ts` even held
// that exact href up as its example of a live destination.
//
// Three more of the same shape shipped beside it: `/operations/log?orderId=`
// (nothing read `orderId`, so "See every attempt" opened the unfiltered log),
// `/upload?…&from=` and `/support?order=&problem=`.
//
// The rule this module enforces: **a link may not carry a query parameter its
// destination does not read.** Registering a parameter is not enough — the
// `readBy` file is verified against source, so a contract cannot outlive the
// code that honoured it.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves the destination route's
// named reader file contains a live (non-comment) read of that parameter. It
// does NOT prove the reader is reachable on that route at the moment the link is
// followed — a `useState` initialiser reads `?tab=` exactly once, on mount, so a
// same-route link can still be inert with a perfectly real reader. That is a
// separate defect and `OrderWorkshop` needed `useTabParamSync` to close it. Read
// a green run here as "the parameter is read somewhere in the component that
// owns this route", not "the link works".
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ROOT, matchesAny, normalizePath } from "./appRoutes";
import { maskLiterals, stripComments, syntaxFor } from "./sourceScan";

/** One parameter a route consumes, and the file that consumes it. */
export type ParamContract = {
  /** The query key, exactly as it appears in a href. */
  param: string;
  /**
   * Repo-relative path of the file that reads it. Verified against source, so
   * this is evidence rather than an assertion.
   */
  readBy: string;
  /** Why the destination needs it — read by a human, not by the gate. */
  purpose: string;
};

/**
 * Route pattern → the parameters that route reads. Patterns use App Router
 * syntax and are matched with the same matcher the other route gates use.
 *
 * Only routes that some in-product link targets WITH a query need an entry.
 * A route with no entry is not "allowed anything" — `unconsumedParams` reports
 * every key on it, so a new query-bearing link must declare its contract here
 * or fail. That is deliberate: silence is how the four dead links above shipped.
 */
export const ROUTE_QUERY_PARAMS: Record<string, readonly ParamContract[]> = {
  "/inbox": [
    {
      param: "status",
      readBy: "src/components/bridge/InboxView.tsx",
      purpose: "Filters the queue. Every /operations/health tile deep-links through it.",
    },
    {
      param: "sort",
      readBy: "src/components/bridge/InboxView.tsx",
      purpose: "`oldest` backs the Overdue tile, which has no age filter to offer.",
    },
    {
      param: "page",
      readBy: "src/components/bridge/InboxView.tsx",
      purpose: "Pagination, so a filtered view is shareable at the page the operator is on.",
    },
  ],
  "/inbox/[orderId]": [
    {
      param: "tab",
      readBy: "src/components/bridge/workshop/OrderWorkshop.tsx",
      purpose:
        "Opens the details drawer on a named tab. `response` is how a refused order shows the supplier's reply.",
    },
    // `sample` was here and is deliberately gone. WP-27 made the practice framing
    // server-driven — `order.isSample`, from PurchaseOrderEntity.IsSample — because
    // the param only ever got appended by useSampleOrder, so a practice order opened
    // from a bookmark, the back button, or an inbox row rendered as real work, and a
    // real order with `?sample=1` pasted on rendered as practice.
    //
    // This registry caught the removal on the merge and asked the right question:
    // "either the reader was removed (every link carrying it is now inert) or the
    // contract names the wrong file." It was the former, and nothing appends the
    // param any more — so the entry goes rather than the reader coming back.
  ],
  "/upload": [
    {
      param: "supplierId",
      readBy: "src/components/bridge/UploadWorkbench.tsx",
      purpose: "Pre-selects the supplier so a re-upload does not start from nothing.",
    },
  ],
  "/library/suppliers/[id]": [
    {
      param: "tab",
      readBy: "src/components/bridge/SupplierDockProfile.tsx",
      purpose: "`delivery` is where every 'set up / check delivery' recovery control lands.",
    },
  ],
  "/settings": [
    {
      param: "tab",
      readBy: "src/app/(app)/settings/page.tsx",
      purpose: "`billing` is the exit from a plan-paused order.",
    },
  ],
  "/operations/log": [
    {
      param: "orderId",
      readBy: "src/components/bridge/CrossingsLog.tsx",
      purpose:
        "Narrows the delivery log to one order. Until a reader existed, the failed-order "
        + "control labelled 'See every attempt' opened the whole workspace's log.",
    },
  ],
  "/support": [
    {
      param: "order",
      readBy: "src/components/marketing/ContactForm.tsx",
      purpose: "Prefills the subject so an escalating operator does not retype what we already know.",
    },
    {
      param: "problem",
      readBy: "src/components/marketing/ContactForm.tsx",
      purpose: "Names the failure state in the subject, in the words the product shows — never the raw status.",
    },
  ],
};

/** The query keys a href carries, in order, ignoring the hash. */
export function queryKeysOf(href: string): string[] {
  const query = href.split("#")[0].split("?")[1];
  if (!query) return [];
  return [...new URLSearchParams(query).keys()];
}

/**
 * The registered route pattern a path belongs to, or null when the path has no
 * declared query contract. Patterns are required to be mutually exclusive —
 * `routePatternsAreUnambiguous` is the test that keeps them so.
 */
export function routePatternFor(path: string): string | null {
  const clean = normalizePath(path);
  return Object.keys(ROUTE_QUERY_PARAMS).find((p) => matchesAny(clean, [p])) ?? null;
}

/**
 * Every query key a href carries that its destination does not declare. Empty
 * for a href with no query at all — a link that asks for nothing cannot be
 * disappointed.
 */
export function unconsumedParams(href: string): string[] {
  const keys = queryKeysOf(href);
  if (keys.length === 0) return [];
  const pattern = routePatternFor(href);
  const declared = new Set((pattern ? ROUTE_QUERY_PARAMS[pattern] : []).map((c) => c.param));
  return keys.filter((k) => !declared.has(k));
}

/**
 * Does `file` contain a live read of `param`?
 *
 * Comments are stripped first, using the repo's one shared stripper. A commented
 * -out reader must not confer a contract: that is the `4c7350a` defect ("a
 * comment after a colon is still a comment") and TRAP 13's named remedy is to
 * reuse this stripper rather than write a second one that drifts from it.
 */
export function paramIsReadBy(param: string, file: string): boolean {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return false;
  const syntax = syntaxFor(file);
  const raw = stripComments(readFileSync(abs, "utf8"), syntax);
  // Stripping comments alone left the same hole one level down: a sentence like
  //   const label = 'we used to call params.get("orderId") here';
  // satisfied the contract with the real reader deleted — proven by renaming the
  // reader and watching this guard stay green. So the match must also be proven
  // to be CODE, not the inside of some larger string.
  //
  // It cannot simply run against masked text, because the thing being matched IS
  // a string literal — masking blanks the very argument that identifies the
  // parameter. `maskLiterals` preserves offsets by construction, so the reliable
  // test is: find the candidate in the raw text, then confirm the code part of it
  // is still there at the same offset after masking. Inside an outer literal it
  // will have been blanked; as real code only the argument's contents are.
  const masked = maskLiterals(raw);

  const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The receiver has to be a search-params object. `formData.get("order")`,
  // `headers.get(…)` and a plain `Map` all look identical to a bare `.get(`
  // pattern, and none of them reads a URL query.
  const receiver = String.raw`(?:searchParams|params|query|sp)`;
  const re = new RegExp(
    String.raw`\b${receiver}\s*\??\.\s*get\(\s*["'\`]${escaped}["'\`]\s*\)`,
    "g",
  );

  for (const match of raw.matchAll(re)) {
    const codeStart = (match.index ?? 0) + match[0].indexOf(".get(");
    if (masked.startsWith(".get(", codeStart)) return true;
  }
  return false;
}

/** Every declared contract, flattened, for tests that walk the whole registry. */
export function allParamContracts(): Array<ParamContract & { pattern: string }> {
  return Object.entries(ROUTE_QUERY_PARAMS).flatMap(([pattern, contracts]) =>
    contracts.map((c) => ({ ...c, pattern })),
  );
}
