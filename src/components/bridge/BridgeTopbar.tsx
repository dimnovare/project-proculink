"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HelpCircle, Menu, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { guideSeenKey, matchGuide } from "@/lib/section-guides";
import type { Order, OrderSummary, Supplier } from "@/types/procurement";
import { buildCrumbTrail, formatCrumbLabel, truncateLabel, type CrumbContext } from "./breadcrumb";
import { CommandPalette } from "./CommandPalette";
import { HelpSlideover } from "./HelpSlideover";
import { SetupProgressChip } from "./SetupProgressChip";

interface BridgeTopbarProps {
  crumb?: ReactNode;
  onMenuClick?: () => void;
}

function AccountMenu() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div
        className="flex items-center justify-center rounded-full text-[11px] font-semibold"
        style={{
          width: 30,
          height: 30,
          background: "linear-gradient(135deg,#2a4b73,#1a3050)",
          color: "#FFFFFF",
          border: "1px solid #1F3252",
        }}
        title="Clerk is not configured"
      >
        MK
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

/**
 * Resolve human names for dynamic path segments from the EXISTING query cache —
 * no new fetch. The detail pages already load these via useQuery, so we read
 * the cached entries by their stable keys:
 *   • order  → ["order", orderId]              (Order.poNumber)
 *   • supplier → ["suppliers"] list            (find by id → Supplier.name)
 *   • connection → ["connection", connectionId] (ConnectionDetail.name)
 */
function useCrumbContext(segments: string[]): CrumbContext {
  const qc = useQueryClient();
  const ctx: CrumbContext = {};

  // /inbox/[orderId]  ·  /upload/preview/[orderId]
  const orderId =
    (segments[0] === "inbox" && segments[1]) ||
    (segments[0] === "upload" && segments[1] === "preview" && segments[2]) ||
    null;
  if (orderId) {
    const order = qc.getQueryData<Order>(["order", orderId]);
    ctx.orderPoNumber = order?.poNumber ?? null;
  }

  // /connections/[connectionId]
  if (segments[0] === "connections" && segments[1]) {
    const connection = qc.getQueryData<{ name?: string }>(["connection", segments[1]]);
    ctx.connectionName = connection?.name ?? null;
  }

  // /library/suppliers/[id]
  if (segments[0] === "library" && segments[1] === "suppliers" && segments[2]) {
    const suppliers = qc.getQueryData<Supplier[]>(["suppliers"]);
    ctx.supplierName = suppliers?.find((s) => s.id === segments[2])?.name ?? null;
  }

  return ctx;
}

/**
 * Derive the full breadcrumb trail from the current pathname. Every crumb except
 * the current page links to its cumulative path; dynamic detail segments resolve
 * to a readable label (PO number / supplier / connection name) from the query
 * cache, falling back to a noun + short id — never a bare full UUID.
 */
function useAutoCrumb(): ReactNode {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);

  if (segments.length === 0) return null;

  const trail = buildCrumbTrail(pathname, ctx);

  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        const display = truncateLabel(crumb.label);
        return (
          <span key={`${crumb.href ?? "current"}-${i}`} style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}>
            {i > 0 && <span aria-hidden style={{ color: "#3A547A", margin: "0 3px", flexShrink: 0 }}>/</span>}
            {crumb.href ? (
              <Link
                href={crumb.href}
                title={crumb.label}
                className="truncate transition-colors hover:underline"
                style={{ color: "#7C8DA6", maxWidth: 220 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#7C8DA6"; }}
              >
                {display}
              </Link>
            ) : (
              // Unlinked crumb: the CURRENT page (last) — or an unrouted group
              // head like "Workbench", which is context, not the current page.
              <span
                aria-current={isLast ? "page" : undefined}
                title={crumb.label}
                className="truncate"
                style={{ color: isLast ? "#C8D1E0" : "#7C8DA6", fontWeight: isLast ? 500 : 400, maxWidth: 260 }}
              >
                {display}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Compact page label for the mobile topbar — the LAST crumb segment as a plain
 * string, resolved through the SAME formatCrumbLabel rules as the desktop trail
 * (so a detail page shows its PO number / supplier / connection name, and never
 * a raw id). Truncated for the narrow mobile bar.
 */
function useMobilePageLabel(): string | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);

  if (segments.length === 0) return null;

  const lastIdx = segments.length - 1;
  return truncateLabel(formatCrumbLabel(segments[lastIdx], lastIdx, segments, ctx), 32);
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

// Status dot colors use the canonical semantic tokens (danger/amber/brand-green)
// rather than literal hex, so they stay in sync with UnifiedStatusBadge.
const NOTIF_META: Record<"review" | "failed" | "delivered", { dot: string; label: string }> = {
  failed:    { dot: "var(--danger)", label: "Delivery failed" },
  review:    { dot: "var(--amber)", label: "Needs review" },
  delivered: { dot: "var(--brand-green)", label: "Delivered" },
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
      if (o.status === "failed" || o.status === "delivery_failed" || o.status === "transform_failed" || o.status === "delivery_dead_letter" || o.status === "rejected_by_supplier") kind = "failed";
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
       (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0) +
       (ordersSummary?.byStatus?.["rejected_by_supplier"] ?? 0))
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
        className="flex items-center justify-center relative"
        style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      >
        {/* Visible 32x32 chip; the button itself is a 44x44 transparent hit area. */}
        <span
          className="flex items-center justify-center rounded-[6px] relative"
          style={{ width: 32, height: 32, background: open ? "#14253D" : "transparent", border: "1px solid transparent", color: open ? "#FFFFFF" : "#C8D1E0", transition: "background 150ms, color 150ms" }}
          onMouseEnter={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "#14253D"; } }}
          onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = "transparent"; } }}
        >
          <Bell size={17} strokeWidth={1.9} />
          {unread > 0 && (
            <span
              className="absolute flex items-center justify-center"
              style={{ top: 4, right: 4, minWidth: 15, height: 15, padding: "0 3.5px", borderRadius: 8, background: "#B36D14", color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, border: "1.5px solid #0B1A2F", lineHeight: 1 }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-x-2 top-14 z-50 w-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-8 sm:w-80"
          style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,.12)", overflow: "hidden" }}
        >
          <div className="flex items-center justify-between" style={{ padding: "10px 12px", borderBottom: "1px solid #E5E8EE" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0B1A2F" }}>Notifications</span>
            {unread > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#B36D14" }}>{unread} need action</span>}
          </div>
          <div className="max-h-[60vh] sm:max-h-[360px]" style={{ overflowY: "auto" }}>
            {top.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: "var(--ink-faint)" }}>No new activity.</div>
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
                      <span style={{ display: "block", fontSize: 11, color: "#5E6779", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{o.poNumber}</span> · {o.supplierName}
                      </span>
                    </span>
                    <span style={{ fontSize: 10, color: "var(--ink-faint)", flexShrink: 0, marginTop: 1 }}>{timeAgo(o.createdAt)}</span>
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); router.push("/inbox"); }}
            className="w-full text-center"
            style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#1E6D29", background: "#FFFFFF", cursor: "pointer", borderTop: "1px solid #E5E8EE" }}
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
  const pathname = usePathname();
  const autoCrumb = useAutoCrumb();
  const mobileLabel = useMobilePageLabel();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Focus management: the slideover moves focus to its search input on open;
  // closing must hand focus back to the "?" trigger.
  const helpBtnRef = useRef<HTMLButtonElement>(null);

  // Unseen-guide dot on the "?" button — discovery cue now that guide content
  // lives only in the help slideover. SSR-safe: state starts false (badge
  // renders nothing) and is computed after mount; opening the slideover is the
  // only "seen" trigger (sets guideSeenKey for the current route).
  const guideRoute = matchGuide(pathname)?.route ?? null;
  const [guideUnseen, setGuideUnseen] = useState(false);
  useEffect(() => {
    if (!guideRoute) {
      setGuideUnseen(false);
      return;
    }
    try {
      setGuideUnseen(window.localStorage.getItem(guideSeenKey(guideRoute)) === null);
    } catch {
      setGuideUnseen(false); // storage blocked — can't remember "seen", never badge
    }
  }, [guideRoute]);

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
      className="on-navy flex-shrink-0 relative flex flex-col"
      style={{ background: "#0B1A2F" }}
    >
      {/* ── Row 1 · Utility row ──────────────────────────────────────
          Mobile menu · demo badge · setup chip · ⌘K search · notifications ·
          help · avatar. This is the control cluster (matches the v2 pages.jsx
          Topbar top utility row). */}
      <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5" style={{ height: 46 }}>
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-[7px] md:hidden"
          style={{
            background: "#14253D",
            border: "1px solid #1F3252",
            color: "#C8D1E0",
          }}
          aria-label="Open navigation"
        >
          <Menu size={18} strokeWidth={2.2} />
        </button>

        {/* Demo-mode badge — gated on the SAME isApiMockMode flag the data layer
            uses (raw NEXT_PUBLIC_USE_MOCK && NODE_ENV !== "production"), so the
            badge and the actual mock-data mode can never diverge. Reading the raw
            env here would show "Demo data" over the user's REAL live orders in a
            production build that still had the flag set. Full pill from sm up; a
            compact dot-only pill on mobile so the honesty signal survives. */}
        {isApiMockMode && (
          <span
            className="inline-flex items-center flex-shrink-0"
            style={{
              gap: 6,
              height: 22,
              padding: "0 10px",
              borderRadius: 99,
              background: "#FAF1DD",
              border: "1px solid #F0D39A",
              color: "#7A4D0B",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
            title="You are viewing mock data. Set NEXT_PUBLIC_USE_MOCK=false to see your organisation's real orders."
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#B36D14",
                display: "inline-block",
              }}
            />
            <span className="hidden sm:inline">Demo data</span>
            <span className="sm:hidden">Demo</span>
          </span>
        )}

        {/* Setup progress chip — visible only while onboarding is genuinely
            incomplete (server-verified); hides itself at completion/unknown. */}
        <SetupProgressChip />

        {/* cmd-K search field — right-aligned, opens the command palette */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          onClick={() => setPaletteOpen(true)}
          className="hidden items-center gap-2.5 rounded-[6px] px-[11px] transition-colors sm:flex ml-auto"
          style={{
            height: 34,
            width: 320,
            maxWidth: "38vw",
            background: "#14253D",
            border: "1px solid #1F3252",
            color: "#7C8DA6",
            fontSize: 12.5,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#294063";
            (e.currentTarget as HTMLElement).style.color = "#C8D1E0";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#1F3252";
            (e.currentTarget as HTMLElement).style.color = "#7C8DA6";
          }}
        >
          <Search size={15} style={{ flexShrink: 0 }} />
          {/* Claims only what the palette index actually searches (offer⇔works). */}
          <span className="flex-1 text-left truncate">Search orders, suppliers, buyers…</span>
          <kbd
            className="flex items-center gap-0.5 rounded text-[10.5px] font-medium"
            style={{ background: "#0a1626", border: "1px solid #1F3252", padding: "1px 5px", color: "#7C8DA6", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Mobile search — icon-only trigger for the command palette (the full
            search field and ⌘K are unreachable below sm). ml-auto here pushes the
            whole icon cluster right on mobile; hidden from sm up where the field shows. */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => setPaletteOpen(true)}
          className="ml-auto flex sm:hidden items-center justify-center rounded-[6px] flex-shrink-0"
          style={{
            width: 32,
            height: 32,
            background: "transparent",
            border: "1px solid transparent",
            color: "#C8D1E0",
            cursor: "pointer",
            transition: "background 150ms, color 150ms",
          }}
        >
          <Search size={17} strokeWidth={1.9} />
        </button>

        {/* Notifications — live popover (needs-review / failed / delivered). */}
        <div className="flex-shrink-0">
          <NotificationsBell />
        </div>

        {/* Help — dot badge while the current route's guide is unseen */}
        <button
          ref={helpBtnRef}
          type="button"
          aria-label={guideUnseen ? "Help — guide available for this screen" : "Help"}
          onClick={() => {
            if (guideRoute) {
              try {
                window.localStorage.setItem(guideSeenKey(guideRoute), new Date().toISOString());
              } catch {
                // storage blocked — the slideover still opens
              }
            }
            setGuideUnseen(false);
            setHelpOpen(true);
          }}
          className="hidden sm:flex items-center justify-center rounded-[6px] relative"
          style={{
            width: 32,
            height: 32,
            background: "transparent",
            border: "1px solid transparent",
            color: "#C8D1E0",
            cursor: "pointer",
            transition: "background 150ms, color 150ms",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          title="Help"
        >
          <HelpCircle size={17} strokeWidth={1.9} />
          {guideUnseen && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#B36D14",
                border: "1.5px solid #0B1A2F",
              }}
            />
          )}
        </button>

        {/* Avatar / Clerk */}
        <div className="flex-shrink-0">
          <AccountMenu />
        </div>
      </div>

      {/* ── Row 2 · Context row ──────────────────────────────────────
          The breadcrumb trail (desktop) / compact page label (mobile). Split
          out below the utility row to give the v2 two-row rhythm. It shows the
          navigation context — NOT a duplicate of the page's own H1 (pages render
          their own heading), so the shell never double-titles. A faint top rule
          separates the two rows. */}
      <div
        className="flex items-center px-3 sm:px-5"
        style={{ height: 38, borderTop: "1px solid #14253D" }}
      >
        {/* Full breadcrumb from sm up */}
        <div
          className="hidden sm:flex min-w-0 items-center gap-2 text-[12.5px]"
          style={{ color: "#C8D1E0" }}
        >
          {crumb ?? autoCrumb}
        </div>
        {/* Mobile: compact single-segment page title so the user always knows
            where they are (the desktop breadcrumb is hidden below sm). */}
        {mobileLabel && (
          <span
            className="sm:hidden min-w-0 truncate text-[13px] font-semibold"
            style={{ color: "#FFFFFF" }}
          >
            {mobileLabel}
          </span>
        )}
      </div>

      {/* Command Palette */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Help slide-over */}
      <HelpSlideover
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          helpBtnRef.current?.focus();
        }}
      />

      {/* Bottom edge — 2px blue→green gradient (matches design --gradient-link-spine) */}
      <div
        className="link-spine"
        data-animated="true"
        key={pathname}
        aria-hidden
      />
    </header>
  );
}
