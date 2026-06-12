"use client";

// CommandPalette — cmd+K fuzzy search across orders, suppliers, buyers, and
// actions (that IS the whole index — keep the placeholder copy in sync).
// Built on cmdk (already installed). Wired into BridgeTopbar.

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getBuyers, isApiMockMode } from "@/lib/api-client";
import type {
  OrderSummary,
  OrderStatus,
  Supplier,
  BuyerDto,
} from "@/types/procurement";

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

function humanStatus(status: OrderStatus): string {
  switch (status) {
    case "pending_review":  return "Needs review";
    case "delivered":       return "Delivered";
    case "ready_to_deliver": return "Ready";
    case "delivery_failed": return "Failed";
    case "parsing":         return "Parsing";
    case "transforming":    return "Transforming";
    default:                return status;
  }
}

function orderColor(status: OrderStatus): string {
  if (status === "pending_review" || status === "delivery_failed") return "#C97A14";
  if (status === "delivered") return "#2E8E3A";
  return "#2E8E3A";
}

function buildIndex(
  router: ReturnType<typeof useRouter>,
  orders: OrderSummary[],
  suppliers: Supplier[],
  buyers: BuyerDto[],
): CmdItem[] {
  const orderItems: CmdItem[] = orders.map((order) => ({
    id: `o-${order.id}`,
    group: "Orders",
    icon: "↗",
    label: order.poNumber,
    sub: `${order.buyerName ?? "Unknown buyer"} → ${order.supplierName ?? "Unknown supplier"} · ${humanStatus(order.status)}`,
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
    { id: "a4",  group: "Actions", icon: "✓", label: "Validation rules",     sub: "Open rule library",      action: () => router.push("/library/rules"),    color: "#0F4FA8" },
    { id: "a5",  group: "Actions", icon: "⚠", label: "Exceptions",           sub: "Open exception dashboard", action: () => router.push("/operations/exceptions"), color: "#C97A14" },
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
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ]               = useState("");
  const [activeIndex, setActive] = useState(0);
  const router                   = useRouter();
  const listRef                  = useRef<HTMLDivElement>(null);
  const activeRef                = useRef<HTMLButtonElement>(null);

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

  // Global Escape still closes even if focus isn't on input
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onClose]);

  // Lock background scroll while the palette is open (it is mounted only when
  // open). Mirrors the mobile nav drawer in (app)/layout.tsx: capture the prior
  // overflow value, force "hidden", and restore it on close/unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

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
          border: "1px solid #E2E6EE",
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
            borderBottom: "1px solid #E2E6EE",
          }}
        >
          <span style={{ fontSize: 16, color: "var(--ink-faint)" }}>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search orders, suppliers, buyers, actions…"
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
              border: "1px solid #E2E6EE",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 420, overflowY: "auto" }}>
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
              <div key={group}>
                <div
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
                        color: item.color ?? "#2E8E3A",
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
                    <span style={{ fontSize: 11, color: "#C6CDDA" }}>↵</span>
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
            borderTop: "1px solid #E2E6EE",
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
                    color: "#56627A",
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
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
