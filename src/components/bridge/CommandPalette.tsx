"use client";

// CommandPalette — cmd+K fuzzy search across orders, suppliers, buyers, and
// actions (that IS the whole index — keep the placeholder copy in sync).
// Built on cmdk (already installed). Wired into BridgeTopbar.

import { useEffect, useState, useRef, useCallback } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getBuyers, isApiMockMode } from "@/lib/api-client";
import { statusFact } from "@/lib/orderStatusManifest";
import { buildMapperCommands, dispatchMapper } from "./mapper/mapperCommands";
import type {
  OrderSummary,
  OrderStatus,
  Supplier,
  BuyerDto,
} from "@/types/procurement";
import { statusLabel } from "./UnifiedStatusBadge";
import { Button } from "./DSPrimitives";

// ─── Index ────────────────────────────────────────────────────────────────────

type CmdItem = {
  id: string;
  label: string;
  sub?: string;
  group: string;
  icon: string;
  href?: string;
  action?: () => void;
  color?: string;
};

// The order glyph's colour is a HEALTH signal, so it is derived from the status
// manifest's bucket — never from a hand-maintained if-chain. The chain this replaced
// ended:
//
//     if (status === "delivered") return "#2E8E3A";
//     return "#2E8E3A";
//
// Two arms, one colour. The `delivered` arm was therefore dead code, and — the part
// that actually hurt — green was the FALLTHROUGH. `failed`, `transform_failed`,
// `delivery_dead_letter`, `rejected_by_supplier`, `delivery_held`,
// `delivery_unconfirmed` and `unrouted` — every one of them painted the same success
// green as a delivered order, in cmd-K, which is the first surface an operator
// reaches for. A broken order read as a finished one.
//
// Deriving from statusFact() means a status added to ORDER_STATUS_FACTS is coloured
// the moment it is added. The chain had to be *remembered* on every status the
// backend grew, and six statuses prove it was not.
function orderColor(status: OrderStatus): string {
  const fact = statusFact(status);
  // Unknown status → neutral ink-muted, NOT green. An unrecognised status is exactly
  // the case where this build understands the row least, and "I have never heard of
  // this" must not be rendered as "this succeeded" — that is the same optimistic
  // default that made the old chain lie. Matches isProblemBucketStatus()'s contract
  // for unknowns: claim nothing rather than claim health.
  if (!fact) return "#56627A";
  // Deliberate exception to the bucket rule. `pending_review` is `healthy` in the
  // manifest and correctly so — nothing broke, the review IS the workflow — but it is
  // a human-action state and this palette has always amber'd it. Green here would say
  // "nobody is needed", which is the opposite of true. Preserved on purpose.
  if (status === "pending_review") return "#B36D14";
  if (fact.bucket === "failure") return "#B43838"; // --danger
  if (fact.bucket === "parked")  return "#B36D14"; // --amber
  return "#2E8E3A";
}

/**
 * Exported for `src/test/failureRecoveryCoverage.test.ts`, which walks every status
 * the backend machine knows and asserts none of the stopped ones paints the success
 * colour here. That is not hypothetical: the chain this replaced ended
 * `if (status === "delivered") return "#2E8E3A"; return "#2E8E3A";` — two branches,
 * one colour — so a dead-lettered or supplier-refused order rendered the same green
 * as a delivered one in the palette an operator opens to find it.
 */
export { orderColor as orderGlyphColor };

// Each row paints item.color TWICE, at two different floors: as the chip's
// 9.4%-alpha FILL (non-text, 3:1) and as the GLYPH inside it. The glyph (✓ ▶ ⊞)
// carries meaning, so it is text and owes 4.5:1 — and #2E8E3A on its own tint is
// only 3.7024:1 (#EBF4EC), or 3.3789:1 over the #F0F4FB active row (#DEEAE9).
// So the glyph alone steps to green-deep: 5.7056:1 / 5.2071:1. item.color itself
// is deliberately NOT changed — the fill keeps it, so the chip looks identical.
//
// ALL THREE FAMILIES ARE MAPPED, not just green. Green was the one the sweep was
// scoped to, but the other two rows fail the same way for the same reason, and a
// map covering one of three would read as "checked" while two thirds of the
// palette still failed. Both replacements are existing tokens; neither is new.
//   #B36D14 (needs-review; and the parked bucket — see below. It carried
//     delivery-failed when this was written; that status is danger now) →
//     3.6662:1 resting, 3.3358:1 active
//     → --amber-text #8A5310: 5.6384:1 / 5.1302:1
//   #1E66C9 (buyers) → 4.8592:1 resting but 4.4231:1 over the active row — the
//     kind of near-miss that only shows up if you measure the state the user is
//     actually looking at when they arrow onto the row
//     → --brand-blue-deep #0F4FA8: 6.8270:1 / 6.2143:1
// These reached the glyph through `orderColor()`, a FUNCTION RETURN, which is
// exactly the indirection src/test/textColorScan.ts documents that it cannot
// follow. Found by measuring, not by the scanner.
//
// TWO MORE FILLS ARE REACHABLE SINCE orderColor() STARTED DERIVING FROM THE BUCKET,
// so the "three families" above is no longer the whole set — five are. Both new ones
// were measured the same way and both CLEAR 4.5:1 unmapped, which is why neither has
// an entry here. Absence is a measurement, not an oversight:
//   #B43838 (--danger, the failure bucket) → 5.1071:1 resting on its own tint
//     (#F8ECEC), 4.6449:1 over the #F0F4FB active row (#EAE2E9). Passing, but by
//     0.14 — if the active-row background is ever darkened, re-measure this first.
//     Left unmapped deliberately: there is no darker danger token in globals.css
//     (only --danger and --danger-soft), and inventing one would break the rule the
//     three mappings above hold to — every replacement is an EXISTING token.
//   #56627A (ink-muted, the unknown-status fallback) → 5.3791:1 resting (#EFF0F2),
//     4.9067:1 active (#E2E6EF). Passing with room.
// The amber row now carries the whole parked bucket — `unrouted`, `delivery_held`,
// `delivery_unconfirmed` — alongside needs-review; same fill, same measurement,
// wider reach.
const GLYPH_TEXT_COLOR: Record<string, string> = {
  "#2E8E3A": "#1E6D29",
  "#B36D14": "#8A5310",
  "#1E66C9": "#0F4FA8",
};

function glyphColor(fill: string): string {
  return GLYPH_TEXT_COLOR[fill] ?? fill;
}

/**
 * The group name order rows are filed under. A constant, not a repeated literal,
 * because the filter loop below has to recognise exactly the rows `buildIndex`
 * produced from the server's search response — and a typo'd second copy would
 * silently reinstate the client-side re-filter it exists to skip.
 */
const ORDERS_GROUP = "Orders";

/**
 * Shortest query that reaches the server search — ONE character.
 *
 * It was two, and the second character is where the bug lived. Below the
 * threshold `debouncedQ` is forced to "" and the order rows fall back to the six
 * most recent, so a one-character query searched six orders out of however many
 * the account holds and then rendered "No results for “x”" — a confident,
 * unqualified statement of absence over 6% of a 100-row page.
 *
 * The obvious objection to lowering it is cost: a request per keystroke. The
 * existing 200ms debounce already answers that. Every keystroke clears the
 * pending timer, so typing "PO-4711" fires ONE request when the typing stops,
 * exactly as it did at a threshold of two. Dropping to one adds a request in
 * precisely one situation — the user types a single character and pauses — which
 * is the situation that was broken. TanStack's 30s `staleTime` keyed on the term
 * absorbs the repeats after that.
 */
const SERVER_SEARCH_MIN_CHARS = 1;

/** How many recent orders the palette previews when it is NOT searching the server. */
const RECENT_PREVIEW_LIMIT = 6;

/**
 * What to say when nothing matched. Four different facts, four different
 * sentences — the point of the whole fix is that "no results" is a claim about
 * REACH as much as about matches, so a screen that has not finished searching,
 * or that only looked at six rows, must not borrow the sentence that means "we
 * searched everything and it is not there".
 *
 * `searchFailed` is the fourth, and it was missing while the other three were
 * being written. The search query's `isError` was never read, so a failed
 * `GET /api/orders?search=` left `searchPage` undefined forever: that made
 * `serverResultsCurrent` false, which made `searchPending` TRUE with no end
 * condition, and cmd-K sat on "Searching all orders…" indefinitely — no error,
 * no retry, no way to tell a dead endpoint from a slow one. It is tested FIRST
 * because a failed query is not a pending one.
 */
export function noResultsMessage(args: {
  query: string;
  searchPending: boolean;
  searchFailed: boolean;
  serverSearchActive: boolean;
  recentReach: number;
}): string {
  const { query, searchPending, searchFailed, serverSearchActive, recentReach } = args;
  if (searchFailed) return `We couldn't search your orders for “${query}”. This isn't a result — try again.`;
  if (searchPending) return "Searching all orders…";
  if (!serverSearchActive && query) {
    return recentReach === 1
      ? "No match in the 1 most recent order shown here."
      : `No match in the ${recentReach} most recent orders shown here.`;
  }
  return `No results for “${query}”`;
}

function buildIndex(
  router: ReturnType<typeof useRouter>,
  orders: OrderSummary[],
  suppliers: Supplier[],
  buyers: BuyerDto[],
): CmdItem[] {
  // The palette lists orders by name and state, so the state has to be the SAME
  // word the row and the badge use. This used to be a local six-case switch:
  // `ready_to_deliver` read "Ready" (the inbox says "Queued to send"),
  // `delivery_failed` read "Failed", `parsing` read "Parsing" (the product says
  // "Extracting") — and every status the switch had not heard of fell through
  // `default: return status`, so a search could turn up an order labelled
  // "delivery_dead_letter". statusLabel() covers all of them and humanizes an
  // unknown key instead of printing it raw.
  const orderItems: CmdItem[] = orders.map((order) => ({
    id: `o-${order.id}`,
    group: ORDERS_GROUP,
    icon: "↗",
    label: order.poNumber,
    sub: `${order.buyerName ?? "Unknown buyer"} → ${order.supplierName ?? "Unknown supplier"} · ${statusLabel(order.status)}`,
    href: `/inbox/${order.id}`,
    color: orderColor(order.status),
  }));

  const supplierItems: CmdItem[] = suppliers.map((s) => ({
    id: `s-${s.id}`,
    group: "Suppliers",
    icon: "⊞",
    label: s.name,
    sub: "Supplier",
    href: `/library/suppliers/${s.id}`,
    color: "#2E8E3A",
  }));

  const buyerItems: CmdItem[] = buyers.map((b) => ({
    id: `b-${b.id}`,
    group: "Buyers",
    icon: "◎",
    label: b.name,
    sub: "Buyer",
    href: "/library/buyers",
    color: "#1E66C9",
  }));

  return [
    ...orderItems,
    ...supplierItems,
    ...buyerItems,
    // ── Actions ────────────────────────────────────────
    { id: "a1",  group: "Actions", icon: "↑", label: "Upload document",      sub: "Open upload workbench",  action: () => router.push("/upload"),           color: "#0F4FA8" },
    // "View order inbox" — the inbox holds orders in EVERY state, not just
    // deliveries, so the old "View all deliveries" label over-claimed.
    { id: "a2",  group: "Actions", icon: "⊞", label: "View order inbox",     sub: "Go to inbox",            action: () => router.push("/inbox"),            color: "#0F4FA8" },
    { id: "a3",  group: "Actions", icon: "⇄", label: "Manage mappings",      sub: "Open mapping editor",    action: () => router.push("/library/mappings"), color: "#0F4FA8" },
    // Checks are set per supplier (Suppliers → a supplier → Rules), which is the
    // only place they actually run — so the palette opens the supplier list
    // rather than an org-wide catalog that decided nothing.
    { id: "a4",  group: "Actions", icon: "✓", label: "Validation rules",     sub: "Choose a supplier to set its checks", action: () => router.push("/library/suppliers"), color: "#0F4FA8" },
    { id: "a5",  group: "Actions", icon: "⚠", label: "Issues",           sub: "Open the issues list", action: () => router.push("/operations/exceptions"), color: "#8A5310" },
    // These two labels are the NAV names, not palette-local ones, and that is
    // load-bearing rather than tidiness. `useSendFlow`'s in-flight notice is plain
    // text with no link slot, so it names its destination in words — "Open System
    // status" / "the Deliveries page" — and the palette is how an operator turns
    // words into a page. It said "System health" and "Delivery log", so searching
    // the exact words the product had just told them to look for found nothing.
    // The search matches `label` AND `sub` (see the filter below), so the older
    // words stay findable in the sub-line rather than being deleted.
    // Canonical source: breadcrumb.ts SEGMENT_LABELS + HubTabs.
    { id: "a6",  group: "Actions", icon: "❤", label: "System status",        sub: "Is order processing running? Check system health", action: () => router.push("/operations/health"),     color: "#0F4FA8" },
    { id: "a9",  group: "Actions", icon: "▤", label: "Deliveries",           sub: "Every delivery attempt — the delivery log", action: () => router.push("/operations/log"),   color: "#0F4FA8" },
    { id: "a7",  group: "Actions", icon: "⚙", label: "Settings",             sub: "Workspace settings",     action: () => router.push("/settings"),         color: "#0F4FA8" },
    { id: "a8",  group: "Actions", icon: "≣", label: "View standards matrix", sub: "Open standards reference", action: () => router.push("/library/standards"), color: "#0F4FA8" },
    // ── Onboarding entry points (task 9) ────────────────────
    { id: "a10", group: "Actions", icon: "✓", label: "Getting started",      sub: "Open the setup checklist", action: () => router.push("/bridge"),          color: "#2E8E3A" },
    // Navigates to /upload, where the sample CTA lives: the palette unmounts
    // on selection, so hosting the useSampleOrder mutation here would lose its
    // onSuccess navigation mid-flight (TanStack observer teardown).
    { id: "a11", group: "Actions", icon: "▶", label: "Run a sample order",   sub: "Practice with an example order — opens Upload", action: () => router.push("/upload"), color: "#2E8E3A" },
    { id: "a12", group: "Actions", icon: "?", label: "Open help",            sub: "Help docs",              action: () => router.push("/help"),             color: "#0F4FA8" },
    // ── Mapper power commands (a13..a16) ────────────────────
    // These dispatch onto the window "plk:mapper" bus; the mounted MapperWorkbench
    // (inbox order review / connection editor) listens and acts on its focused field.
    // They show always (progressive disclosure — discoverable for anyone who needs them);
    // outside the mapper the dispatch is a harmless no-op (no listener attached).
    ...buildMapperCommands(dispatchMapper).map((c) => ({
      id: c.id,
      group: c.group,
      icon: c.icon,
      label: c.label,
      sub: c.sub,
      action: c.run,
      color: c.color,
    })),
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ]               = useState("");
  const [activeIndex, setActive] = useState(0);
  const router                   = useRouter();
  const listRef                  = useRef<HTMLDivElement>(null);
  const activeRef                = useRef<HTMLButtonElement>(null);
  const paletteRef               = useRef<HTMLDivElement>(null);

  // Debounce the user's query before firing a server search — avoids a request per keystroke.
  // The term is TRIMMED before it is debounced, sent, or matched. The backend trims it too
  // (`search.Trim()` in OrderQueryService), so an untrimmed client copy of the term filtered
  // out rows the server had just matched: paste a PO number with a trailing space and the
  // server returned the order while the client dropped it and reported no results.
  const normalizedQ = q.trim();
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const term = q.trim();
    if (term.length < SERVER_SEARCH_MIN_CHARS) { setDebouncedQ(""); return; }
    const t = setTimeout(() => setDebouncedQ(term), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60_000,
  });

  const {
    data: searchPage,
    isFetching: searchFetching,
    isError: searchIsError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ["orders-search", debouncedQ],
    queryFn: () => apiClient.getOrders({ search: debouncedQ, pageSize: 8 }),
    staleTime: 30_000,
    enabled: !isApiMockMode && debouncedQ.length >= SERVER_SEARCH_MIN_CHARS,
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    staleTime: 60_000,
  });
  const { data: buyers } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => getBuyers(),
    staleTime: 60_000,
  });

  // When search term is active and server results are available, use them (all orders searchable).
  // Otherwise fall back to the recent-orders preview (empty query, or mock mode).
  const serverSearchActive = !isApiMockMode && normalizedQ.length >= SERVER_SEARCH_MIN_CHARS;
  // The response answers THIS query only once the debounce has caught up AND the request has
  // landed. Until then the palette knows nothing about the term the user is looking at, and
  // `searchPage` is `undefined` (TanStack drops data when the key changes) — which read as
  // zero rows and printed "No results" over a search that had not been made yet.
  const serverResultsCurrent =
    serverSearchActive && debouncedQ === normalizedQ && !searchFetching && searchPage !== undefined;
  // The request answered with an error and left nothing behind. Without this the
  // condition below can never become false, so "Searching all orders…" was a
  // terminal state rather than a transient one.
  const searchFailed =
    serverSearchActive && debouncedQ === normalizedQ && !searchFetching && searchIsError && searchPage === undefined;
  const searchPending = serverSearchActive && !serverResultsCurrent && !searchFailed;

  const recentPreview = (ordersPage?.items ?? []).slice(0, RECENT_PREVIEW_LIMIT);
  const orderResults: OrderSummary[] = serverSearchActive ? (searchPage?.items ?? []) : recentPreview;

  const items = buildIndex(router, orderResults, suppliers ?? [], buyers ?? []);

  // Build filtered groups + flat list for keyboard nav
  const groups: Record<string, CmdItem[]> = {};
  const sq = normalizedQ.toLowerCase();
  for (const item of items) {
    // Order rows from the server search are ALREADY filtered — by Postgres, over PoNumber,
    // Supplier.Name and BuyerName, which is the same information this loop reads out of
    // `label` and `sub`. Running the substring test over them again can therefore only ever
    // DISCARD a real match, never find one, and Postgres `ILIKE '%term%'` and JS
    // `.includes()` disagree in ways the user cannot see: `%` and `_` in the term are
    // wildcards to one and literals to the other, and case folding follows the DB collation
    // rather than `toLowerCase()`. Every such disagreement surfaced as "No results" printed
    // on top of a NON-EMPTY server response, which is the worst reading of all — the account
    // holds the order, the API returned it, and the screen denies both.
    const preFiltered = serverResultsCurrent && item.group === ORDERS_GROUP;
    if (!preFiltered && sq && !item.label.toLowerCase().includes(sq) && !(item.sub ?? "").toLowerCase().includes(sq)) continue;
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }
  const flatItems = Object.values(groups).flat();
  const hasResults = flatItems.length > 0;

  function run(item: CmdItem) {
    onClose();
    setQ("");
    if (item.action) { item.action(); return; }
    if (item.href)   router.push(item.href);
  }

  // Reset active index when query changes
  useEffect(() => { setActive(0); }, [q]);

  // Scroll active item into view when index changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatItems[activeIndex]) {
      e.preventDefault();
      run(flatItems[activeIndex]);
    } else if (e.key === "Escape") {
      onClose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatItems, activeIndex, onClose]);

  // Focus trap + Escape + focus restore + scroll lock — one shared contract
  // (src/hooks/useDialogA11y.ts) instead of the local copy this file used to
  // carry. The palette mounts only while open, so `open` is constant true.
  // `autoFocus: false` — the search input already autoFocuses itself.
  useDialogA11y({ open: true, onClose, panelRef: paletteRef, autoFocus: false });

  // Track flat index across groups for active highlighting
  let flatIdx = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,26,47,0.55)",
          backdropFilter: "blur(4px)",
          zIndex: 9998,
        }}
        onClick={onClose}
      />

      {/* Palette */}
      <div
        ref={paletteRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          position: "fixed",
          top: "20vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          maxWidth: "calc(100vw - 32px)",
          background: "#FFFFFF",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(11,26,47,0.22), 0 4px 12px rgba(11,26,47,0.12)",
          border: "1px solid #E5E8EE",
          overflow: "hidden",
          zIndex: 9999,
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid #E5E8EE",
          }}
        >
          <span style={{ fontSize: 16, color: "var(--ink-faint)" }}>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search orders, suppliers, buyers, actions…"
            role="combobox"
            aria-label="Search orders, suppliers, buyers, actions"
            aria-autocomplete="list"
            aria-expanded={hasResults}
            aria-controls="cmd-listbox"
            aria-activedescendant={hasResults ? `cmd-option-${activeIndex}` : undefined}
            style={{
              flex: 1,
              border: "none",
              fontSize: 14,
              color: "#0B1A2F",
              background: "transparent",
            }}
          />
          <kbd
            style={{
              fontSize: 10.5,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--ink-faint)",
              background: "#F6F7FA",
              border: "1px solid #E5E8EE",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="cmd-listbox"
          role={hasResults ? "listbox" : undefined}
          aria-label={hasResults ? "Results" : undefined}
          style={{ maxHeight: 420, overflowY: "auto" }}
        >
          {/* Rendered whether or not anything else matched. Actions, suppliers and
              buyers are matched client-side and are unaffected by a failed order
              search, so on failure the palette can still be full of rows — which
              is precisely when a silent failure is most misleading, because the
              rows present look like the complete answer. */}
          {searchFailed && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 16px",
                background: "var(--danger-soft)",
                borderBottom: "1px solid var(--danger-border)",
                color: "var(--danger)",
                fontSize: 12.5,
              }}
            >
              <span>
                {noResultsMessage({
                  query: normalizedQ,
                  searchPending,
                  searchFailed,
                  serverSearchActive,
                  recentReach: recentPreview.length,
                })}
              </span>
              <span style={{ flexShrink: 0 }}>
                <Button variant="secondary" size="sm" onClick={() => { void refetchSearch(); }}>
                  Try again
                </Button>
              </span>
            </div>
          )}
          {/* The failure strip above already carries the sentence and the control,
              so the empty block would only repeat it. */}
          {!hasResults && searchFailed ? null : !hasResults ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--ink-faint)",
                fontSize: 13,
              }}
            >
              {noResultsMessage({
                query: normalizedQ,
                searchPending,
                searchFailed,
                serverSearchActive,
                recentReach: recentPreview.length,
              })}
            </div>
          ) : (
            Object.entries(groups).map(([group, groupItems]) => (
              <div key={group} role="group" aria-label={group}>
                <div
                  aria-hidden="true"
                  style={{
                    padding: "8px 16px 4px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                  }}
                >
                  {group}
                </div>
                {groupItems.map((item) => {
                  const isActive = flatIdx === activeIndex;
                  const currentIdx = flatIdx++;
                  return (
                  <button
                    key={item.id}
                    id={`cmd-option-${currentIdx}`}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    ref={isActive ? activeRef : undefined}
                    onClick={() => run(item)}
                    onMouseEnter={() => setActive(currentIdx)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px",
                      border: "none",
                      background: isActive ? "#F0F4FB" : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      borderLeft: isActive ? "2px solid #2E8E3A" : "2px solid transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Icon */}
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: `${item.color ?? "#2E8E3A"}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        // Text floor, not the fill's — see GLYPH_TEXT_COLOR.
                        color: glyphColor(item.color ?? "#2E8E3A"),
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </span>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#0B1A2F",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.label}
                      </div>
                      {item.sub && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--ink-faint)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.sub}
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <span style={{ fontSize: 11, color: "#CBD0DA" }}>↵</span>
                  </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 16px",
            borderTop: "1px solid #E5E8EE",
            background: "#F6F7FA",
          }}
        >
          {[["↵", "open"], ["↑↓", "navigate"], ["esc", "close"]].map(
            ([key, label]) => (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <kbd
                  style={{
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "#5E6779",
                    background: "#FFFFFF",
                    border: "1px solid #E5E8EE",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  {key}
                </kbd>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</span>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
