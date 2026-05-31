"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Bell, Menu, Search } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { OrderSummary } from "@/types/procurement";
import { CommandPalette } from "./CommandPalette";
import { HelpSlideover } from "./HelpSlideover";

interface BridgeTopbarProps {
  crumb?: ReactNode;
  onMenuClick?: () => void;
}

function AccountMenu() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div
        className="flex items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          width: 28,
          height: 28,
          background: "#E2F1E2",
          color: "#1E6D29",
        }}
        title="Clerk is not configured"
      >
        D
      </div>
    );
  }

  return (
    <UserButton
      appearance={{
        elements: {
          userButtonAvatarBox: "w-7 h-7",
        },
      }}
    />
  );
}

/** Derive a 1–2-segment breadcrumb from the current pathname. */
function useAutoCrumb(): ReactNode {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean);

  const LABELS: Record<string, string> = {
    bridge:    "Order topology",
    inbox:     "Inbox",
    upload:    "Upload",
    drafts:    "Drafts",
    settings:  "Settings",
    library:   "Library",
    suppliers: "Suppliers",
    buyers:    "Buyers",
    mappings:  "Mappings",
    rules:     "Validation rules",
    templates: "Output templates",
    standards: "Standards",
    operations: "Operations",
    log:       "Delivery log",
    connectors: "Connectors",
    webhooks:  "Webhooks",
  };

  if (seg.length === 0) return null;

  const root = LABELS[seg[0]] ?? seg[0];

  // Two-segment paths like /library/suppliers or /operations/log
  if (seg.length >= 2 && LABELS[seg[1]]) {
    return (
      <>
        <span style={{ color: "#7C8DA6" }}>{root}</span>
        <span style={{ color: "#3A547A", margin: "0 3px" }}>/</span>
        <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{LABELS[seg[1]]}</span>
      </>
    );
  }

  // Detail pages like /inbox/[id] or /library/suppliers/[id]
  if (seg.length >= 2 && !LABELS[seg[1]]) {
    const slug = seg[1].length > 16 ? seg[1].slice(0, 15) + "…" : seg[1];
    return (
      <>
        <span style={{ color: "#7C8DA6" }}>{root}</span>
        <span style={{ color: "#3A547A", margin: "0 3px" }}>/</span>
        <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{slug}</span>
      </>
    );
  }

  return <span style={{ color: "#C5D2E4", fontWeight: 500 }}>{root}</span>;
}

// ─── Notifications popover ──────────────────────────────────────────────────
// Live, honest notifications derived from the order queue: needs-review and
// failed orders are actionable (drive the unread count); delivered are activity.
// No fake unread dot — the badge only appears when something genuinely needs action.

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const NOTIF_META: Record<"review" | "failed" | "delivered", { dot: string; label: string }> = {
  failed:    { dot: "#C53A3A", label: "Delivery failed" },
  review:    { dot: "#C97A14", label: "Needs review" },
  delivered: { dot: "#2E8E3A", label: "Delivered" },
};

function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
  });

  const items = (ordersPage?.items ?? [])
    .map((o) => {
      let kind: "review" | "failed" | "delivered" | null = null;
      if (o.status === "failed" || o.status === "delivery_failed" || o.status === "transform_failed") kind = "failed";
      else if (o.status === "pending_review" || (o.unresolvedCount ?? 0) > 0) kind = "review";
      else if (o.status === "delivered") kind = "delivered";
      return kind ? { o, kind } : null;
    })
    .filter((x): x is { o: OrderSummary; kind: "review" | "failed" | "delivered" } => x !== null);

  const rank = (k: string) => (k === "failed" ? 0 : k === "review" ? 1 : 2);
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || new Date(b.o.createdAt).getTime() - new Date(a.o.createdAt).getTime());
  const top = items.slice(0, 7);
  const unread = !isApiMockMode
    ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
       (ordersSummary?.byStatus?.["failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0))
    : items.filter((i) => i.kind === "failed" || i.kind === "review").length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} need action` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-full relative"
        style={{ width: 24, height: 24, background: "#10243E", border: "1px solid #1C2F49", color: open ? "#C5D2E4" : "#7C8DA6", cursor: "pointer" }}
        title="Notifications"
      >
        <Bell size={13} strokeWidth={2} />
        {unread > 0 && (
          <span
            className="absolute"
            style={{ top: -4, right: -4, minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7, background: "#C53A3A", color: "#FFFFFF", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #0B1A2F", lineHeight: 1 }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50"
          style={{ top: 32, width: 320, background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,.12)", overflow: "hidden" }}
        >
          <div className="flex items-center justify-between" style={{ padding: "10px 12px", borderBottom: "1px solid #E2E6EE" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0B1A2F" }}>Notifications</span>
            {unread > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#C97A14" }}>{unread} need action</span>}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {top.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: "#8A93A5" }}>No new activity.</div>
            ) : (
              top.map(({ o, kind }) => {
                const meta = NOTIF_META[kind];
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setOpen(false); router.push(`/inbox/${o.id}`); }}
                    className="w-full text-left flex items-start gap-2.5"
                    style={{ padding: "9px 12px", borderBottom: "1px solid #F0F2F6", background: "#FFFFFF", cursor: "pointer" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F6F7FA"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.dot, marginTop: 5, flexShrink: 0 }} />
                    <span className="min-w-0 flex-1">
                      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#0B1A2F" }}>{meta.label}</span>
                      <span style={{ display: "block", fontSize: 11, color: "#56627A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{o.poNumber}</span> · {o.supplierName}
                      </span>
                    </span>
                    <span style={{ fontSize: 10, color: "#8A93A5", flexShrink: 0, marginTop: 1 }}>{timeAgo(o.createdAt)}</span>
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); router.push("/inbox"); }}
            className="w-full text-center"
            style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#0F4FA8", background: "#FFFFFF", cursor: "pointer", borderTop: "1px solid #E2E6EE" }}
          >
            View all in inbox →
          </button>
        </div>
      )}
    </div>
  );
}

export function BridgeTopbar({ crumb, onMenuClick }: BridgeTopbarProps) {
  const router = useRouter();
  const autoCrumb = useAutoCrumb();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Global cmd+K listener
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <header
      className="flex-shrink-0 relative"
      style={{ height: 56, background: "#0B1A2F" }}
    >
      {/* Content row */}
      <div className="flex h-full items-center gap-3 px-3 sm:px-5">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-[7px] md:hidden"
          style={{
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#C5D2E4",
          }}
          aria-label="Open navigation"
        >
          <Menu size={18} strokeWidth={2.2} />
        </button>

        {/* Demo-mode badge — visible only when NEXT_PUBLIC_USE_MOCK=true */}
        {process.env.NEXT_PUBLIC_USE_MOCK === "true" && (
          <span
            className="hidden sm:inline-flex items-center"
            style={{
              gap: 6,
              height: 22,
              padding: "0 10px",
              borderRadius: 99,
              background: "#FAEFD6",
              border: "1px solid #F0D39A",
              color: "#7A4D0B",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
            title="You are viewing mock data. Set NEXT_PUBLIC_USE_MOCK=false to see your organisation's real orders."
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#C97A14",
                display: "inline-block",
              }}
            />
            Demo data
          </span>
        )}

        {/* Breadcrumbs */}
        <div
          className="flex min-w-0 items-center gap-1.5 text-[13px] flex-shrink-0"
          style={{ color: "#C5D2E4" }}
        >
          {crumb ?? autoCrumb}
        </div>

        {/* cmd-K search field — wide, opens the command palette */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          onClick={() => setPaletteOpen(true)}
          className="hidden flex-1 max-w-[480px] items-center gap-2 rounded-[7px] px-3 transition-colors sm:flex sm:mx-auto"
          style={{
            height: 34,
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#7C8DA6",
            fontSize: 12.5,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#2A4A70";
            (e.currentTarget as HTMLElement).style.color = "#C5D2E4";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#1C2F49";
            (e.currentTarget as HTMLElement).style.color = "#7C8DA6";
          }}
        >
          <Search size={14} style={{ flexShrink: 0 }} />
          <span className="flex-1 text-left">Search orders, suppliers, SKUs…</span>
          <kbd
            className="flex items-center gap-0.5 rounded text-[10px] font-medium px-1"
            style={{ background: "#0B1A2F", color: "#7C8DA6" }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Notifications — live popover (needs-review / failed / delivered) */}
        <NotificationsBell />

        {/* Help */}
        <button
          type="button"
          aria-label="Help"
          onClick={() => setHelpOpen(true)}
          className="flex items-center justify-center rounded-full text-[11px] font-bold"
          style={{
            width: 24,
            height: 24,
            background: "#10243E",
            border: "1px solid #1C2F49",
            color: "#7C8DA6",
            cursor: "pointer",
          }}
          title="Help"
        >
          ?
        </button>

        {/* Avatar / Clerk */}
        <div className="flex-shrink-0">
          <AccountMenu />
        </div>
      </div>

      {/* Command Palette */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Help slide-over */}
      <HelpSlideover open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Link-spine — 2px gradient line at bottom edge */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: 2,
          background:
            "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
        }}
        aria-hidden
      />
    </header>
  );
}
