"use client";

// CommandPalette — cmd+K fuzzy search across orders, suppliers, buyers, and
// actions (that IS the whole index — keep the placeholder copy in sync).
// Built on cmdk (already installed). Wired into BridgeTopbar.

import { useEffect, useState, useRef, useCallback } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getBuyers, isApiMockMode } from "@/lib/api-client";
import { buildMapperCommands, dispatchMapper } from "./mapper/mapperCommands";
import type {
  OrderSummary,
  OrderStatus,
  Supplier,
  BuyerDto,
} from "@/types/procurement";
import { statusLabel } from "./UnifiedStatusBadge";

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

function orderColor(status: OrderStatus): string {
  if (status === "pending_review" || status === "delivery_failed") return "#B36D14";
  if (status === "delivered") return "#2E8E3A";
  return "#2E8E3A";
}

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
//   #B36D14 (needs-review / delivery-failed) → 3.6662:1 resting, 3.3358:1 active
//     → --amber-text #8A5310: 5.6384:1 / 5.1302:1
//   #1E66C9 (buyers) → 4.8592:1 resting but 4.4231:1 over the active row — the
//     kind of near-miss that only shows up if you measure the state the user is
//     actually looking at when they arrow onto the row
//     → --brand-blue-deep #0F4FA8: 6.8270:1 / 6.2143:1
// These reached the glyph through `orderColor()`, a FUNCTION RETURN, which is
// exactly the indirection src/test/textColorScan.ts documents that it cannot
// follow. Found by measuring, not by the scanner.
const GLYPH_TEXT_COLOR: Record<string, string> = {
  "#2E8E3A": "#1E6D29",
  "#B36D14": "#8A5310",
  "#1E66C9": "#0F4FA8",
};

function glyphColor(fill: string): string {
  return GLYPH_TEXT_COLOR[fill] ?? fill;
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
    group: "Orders",
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
    { id: "a6",  group: "Actions", icon: "❤", label: "System health",        sub: "Open operator health view", action: () => router.push("/operations/health"),     color: "#0F4FA8" },
    { id: "a9",  group: "Actions", icon: "▤", label: "Delivery log",         sub: "Open delivery log",      action: () => router.push("/operations/log"),   color: "#0F4FA8" },
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
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    if (q.length < 2) { setDebouncedQ(""); return; }
    const t = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    staleTime: 60_000,
  });

  const { data: searchPage } = useQuery({
    queryKey: ["orders-search", debouncedQ],
    queryFn: () => apiClient.getOrders({ search: debouncedQ, pageSize: 8 }),
    staleTime: 30_000,
    enabled: !isApiMockMode && debouncedQ.length >= 2,
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
  // Otherwise fall back to first 6 from the working set (empty query = recent orders preview).
  const orderResults: OrderSummary[] = debouncedQ.length >= 2 && !isApiMockMode
    ? (searchPage?.items ?? [])
    : (ordersPage?.items ?? []).slice(0, 6);

  const items = buildIndex(router, orderResults, suppliers ?? [], buyers ?? []);

  // Build filtered groups + flat list for keyboard nav
  const groups: Record<string, CmdItem[]> = {};
  for (const item of items) {
    const label = item.label.toLowerCase();
    const sq    = q.toLowerCase();
    if (sq && !label.includes(sq) && !(item.sub ?? "").toLowerCase().includes(sq)) continue;
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
          {!hasResults ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--ink-faint)",
                fontSize: 13,
              }}
            >
              No results for &ldquo;{q}&rdquo;
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
