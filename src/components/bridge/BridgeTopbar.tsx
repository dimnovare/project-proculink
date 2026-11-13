"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Lock, Menu, Search, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { checkAdminAccess, getBillingStatus, isApiMockMode } from "@/lib/api-client";
import { guideSeenKey, matchGuide } from "@/lib/section-guides";
import { planDisplayName } from "@/lib/plans";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrganization } from "@clerk/nextjs";
import { buildCrumbTrail, formatCrumbLabel, isLonePageCrumb, truncateLabel, type CrumbContext } from "./breadcrumb";
import { CommandPalette } from "./CommandPalette";
import { ProcuLinkMark } from "./DSPrimitives";
import { HelpSlideover } from "./HelpSlideover";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserChipMenu } from "./UserChipMenu";
import { buildVisibleNav, isItemActive, PINNED_ACTION_HREF, type SidebarNavItem } from "./BridgeSidebar";

interface BridgeTopbarProps {
  crumb?: ReactNode;
  onMenuClick?: () => void;
}

/**
 * Resolve human names for dynamic path segments from the EXISTING query cache —
 * no new fetch. The detail pages already load these via useQuery, so we read
 * the cached entries by their stable keys (flow, document, output, lookup).
 */
function useCrumbContext(segments: string[]): CrumbContext {
  const qc = useQueryClient();
  const ctx: CrumbContext = {};

  // /flows/[id] and /flows/[id]/documents/[id] (the document carries its flow's name)
  if (segments[0] === "flows" && segments[1]) {
    const doc = segments[3] ? qc.getQueryData<{ summary?: { fileName?: string; flowName?: string } }>(["document", segments[3]])?.summary : undefined;
    ctx.flowName = qc.getQueryData<{ name?: string }>(["flow", segments[1]])?.name ?? doc?.flowName ?? null;
    ctx.documentName = doc?.fileName ?? null;
    if (segments[2] === "outputs" && segments[3])
      ctx.outputName = qc.getQueryData<{ id: string; name?: string }[]>(["outputs", segments[1]])?.find((o) => o.id === segments[3])?.name ?? null;
  }

  // /lookups/[id]
  if (segments[0] === "lookups" && segments[1]) ctx.lookupName = qc.getQueryData<{ name?: string }>(["lookup", segments[1]])?.name ?? null;

  return ctx;
}

/**
 * Derive the full breadcrumb trail from the current pathname. Every crumb except
 * the current page links to its cumulative path; dynamic detail segments resolve
 * to a readable label (flow / document / lookup name) from the query cache,
 * falling back to a noun + short id — never a bare full UUID.
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
                className="tap-wide inline-block truncate transition-colors hover:underline"
                style={{ color: "#7C8DA6", maxWidth: 220, minHeight: 24, lineHeight: "24px" }}
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
 * (so a detail page shows its record's name, and never a raw id). Truncated for
 * the narrow mobile bar.
 */
function useMobilePageLabel(): string | null {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const ctx = useCrumbContext(segments);

  if (segments.length === 0) return null;

  const lastIdx = segments.length - 1;
  return truncateLabel(formatCrumbLabel(segments[lastIdx], lastIdx, segments, ctx), 32);
}

// ─── Desktop primary navigation (top navbar, md+) ───────────────────────────
// The sidebar was removed on desktop; its primary nav now renders here as a
// horizontal link row. Structure, gating and active-state are REUSED wholesale
// from BridgeSidebar (buildVisibleNav / isItemActive) so the two can never
// drift — this row is the sidebar's nav, re-laid-out horizontally.

/** One horizontal nav link. Active = white + 2px blue underline; inactive =
 *  #C8D1E0 → white on hover. Mirrors the sidebar's semantics, not its chrome. */
function TopNavLink({
  item,
  active,
  onNavigate,
}: {
  item: SidebarNavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
      aria-current={active ? "page" : undefined}
      className="relative inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
      style={{
        height: "100%",
        padding: "0 10px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? "#FFFFFF" : "#C8D1E0",
        borderBottom: active ? "2px solid #1E66C9" : "2px solid transparent",
        textDecoration: "none",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#FFFFFF"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "#C8D1E0"; }}
    >
      {item.label}
    </Link>
  );
}

/**
 * The horizontal primary nav for md+. Reuses buildVisibleNav (admin gating) and
 * isItemActive. Groups are flattened to a single horizontal row (group headers
 * belong to the vertical rail, not a top bar).
 * Overflows scroll horizontally at the md→lg band so links never wrap or clip.
 * Returns the admin-gated `tail` items so the caller can place them in the
 * right cluster (Admin) / profile menu (Settings) without re-deriving the gate.
 */
function useTopNav() {
  const pathname = usePathname();
  const queryEnabled = useTenantQueriesEnabled();

  const { data: adminAccess } = useQuery({
    queryKey: ["admin-access"],
    queryFn: checkAdminAccess,
    enabled: queryEnabled,
    staleTime: 300_000,
    retry: false,
  });
  const isAdmin = adminAccess === true;
  const { main, tail } = useMemo(() => buildVisibleNav(isAdmin), [isAdmin]);
  // Flatten grouped sections into a single ordered list for the horizontal row.
  const items = useMemo(() => main.flatMap((s) => s.items), [main]);

  return { items, tail, pathname };
}

// ─── Desktop brand + workspace switcher (top navbar left cluster) ────────────

/** Live workspace name + billing plan for the compact OrgSwitcher. */
function useWorkspaceCardData() {
  const queryEnabled = useTenantQueriesEnabled();
  const { organization } = useOrganization();
  const { data: billing } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
    staleTime: 60_000,
  });
  // Derived from the ladder, not from the wire value. Capitalising the first letter of
  // `billing.plan` agrees with the ladder only by coincidence — it is a string operation on
  // an identifier, and it would render a future two-word tier as "Highvolume plan".
  const planLabel = billing ? planDisplayName(billing.plan) : "Loading…";
  const orgName = organization?.name ?? "Your workspace";
  return { orgName, planLabel, activePlan: billing ? planLabel : null };
}

export function BridgeTopbar({ crumb, onMenuClick }: BridgeTopbarProps) {
  const pathname = usePathname();
  const { items: navItems, tail: navTail } = useTopNav();
  const { orgName, planLabel, activePlan } = useWorkspaceCardData();
  const adminItem = navTail.find((t) => t.href === "/admin");
  const autoCrumb = useAutoCrumb();
  const mobileLabel = useMobilePageLabel();
  // Double-navbar guard (founder screenshot, 2026-07-24): on a top-level page
  // like Dashboard the context row's whole content was a lone unlinked crumb
  // repeating the nav item directly above it. It links nowhere, so it is pure
  // duplication wherever the primary nav row shows (md+, `hidden md:flex`) —
  // hide the row there. Below md that row is hidden and this is the ONLY label
  // naming the page (these pages render their h1 sr-only via PageHeader
  // `titleHidden`), so the row is kept.
  const loneCrumbRow = !crumb && isLonePageCrumb(pathname);
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
      {/* ── Row 1 · Primary nav bar ──────────────────────────────────
          The desktop sidebar was removed; its primary navigation lives here.
          LEFT   = mobile hamburger · ProcuLink brand (→ /documents) · compact
                   OrgSwitcher.
          CENTER = the primary nav as horizontal links (md+), built from the
                   SAME buildVisibleNav/isItemActive the sidebar used; scrolls
                   horizontally at the md→lg band so links never wrap or clip.
          RIGHT  = Upload document · demo chip · ⌘K search ·
                   Admin (admin-gated) · Help · account chip.
          Mobile (< md) collapses to hamburger + brand + the compact control
          cluster; the full nav is reached through the drawer (onMenuClick). */}
      {/* `md:gap-2 lg:gap-3` — 768 is the tightest width this row ever has, and the
          only one where it overflowed. It is the breakpoint at which BOTH the
          workspace switcher (`hidden md:block`) and the cmd-K search
          (`hidden md:flex`) appear, so everything is on screen at the narrowest
          width that shows everything. Every child is `flex-shrink-0`, so the
          surplus went to the last item: the Help button's 44px hit area was
          clipped 2px past the right edge on the (since deleted) order review and
          supplier screens. Measured by the control sweep at 768.

          Narrowing the gap for that band only recovers far more than the 2px and
          leaves 390 and 1440 untouched. The alternative — letting the workspace
          switcher shrink — would truncate a workspace name to save a gap, which
          is the worse trade. */}
      <div className="flex items-center gap-2 sm:gap-3 md:gap-2 lg:gap-3 px-3 sm:px-5" style={{ height: 52 }}>
        {/* Mobile menu — opens the BridgeSidebar drawer (full nav on < md). */}
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-11 w-11 items-center justify-center rounded-[7px] md:hidden flex-shrink-0"
          style={{
            background: "#14253D",
            border: "1px solid #1F3252",
            color: "#C8D1E0",
          }}
          aria-label="Open navigation"
        >
          <Menu size={18} strokeWidth={2.2} />
        </button>

        {/* Brand mark → Documents. */}
        <Link
          href="/documents"
          aria-label="ProcuLink — go to dashboard"
          className="flex items-center gap-2 flex-shrink-0"
          style={{ color: "#FFFFFF", textDecoration: "none" }}
        >
          <ProcuLinkMark size={24} mono />
          <span
            className="hidden sm:inline"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: "-0.015em" }}
          >
            ProcuLink
          </span>
        </Link>

        {/* Compact workspace switcher (opens a downward menu of real orgs). */}
        <div className="hidden md:block flex-shrink-0">
          <OrgSwitcher compact orgName={orgName} planLabel={planLabel} activePlan={activePlan} />
        </div>

        {/* Demo-mode badge — gated on the SAME isApiMockMode flag the data layer
            uses, so the badge and the actual mock-data mode can never diverge.
            Full pill from sm up; a compact dot-only pill on mobile. `ml-auto`
            starts the right control cluster (also nudges controls right on
            mobile where the nav is hidden). */}
        {isApiMockMode ? (
          <span
            className="ml-auto inline-flex items-center flex-shrink-0"
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
        ) : (
          // Anchor the right cluster to the row's end even when the demo badge
          // is absent (keeps the nav left-of-center and controls flush right).
          <span className="ml-auto" aria-hidden />
        )}

        {/* Upload document — pinned primary create action (reuses the sidebar's
            PINNED_ACTION_HREF). Blue = buyer/source action per the semantic law.
            md+ shows the labelled button; mobile keeps it in the drawer. */}
        <Link
          href={PINNED_ACTION_HREF}
          className="hidden md:flex items-center justify-center gap-2 flex-shrink-0 text-white"
          style={{ height: 34, padding: "0 13px", borderRadius: 8, background: "#1E66C9", fontSize: 13, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.14)", textDecoration: "none", transition: "background 140ms" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#0F4FA8"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#1E66C9"; }}
        >
          <Upload size={15} strokeWidth={2} />
          <span>Upload document</span>
        </Link>

        {/* Search — icon-only trigger for the ⌘K command palette (sm+). Icon-only
            in the top nav so the primary nav keeps the row's width; the palette is
            the real search. Kept a title with the ⌘K hint. */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          title="Search — ⌘K"
          onClick={() => setPaletteOpen(true)}
          className="hidden sm:flex items-center justify-center flex-shrink-0"
          style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          {/* Visible 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). */}
          <span
            className="flex items-center justify-center rounded-[6px]"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Search size={17} strokeWidth={1.9} />
          </span>
        </button>

        {/* Mobile search — icon-only trigger for the command palette. */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => setPaletteOpen(true)}
          className="flex sm:hidden items-center justify-center flex-shrink-0"
          style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). */}
          <span
            className="flex items-center justify-center rounded-[6px]"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0" }}
          >
            <Search size={17} strokeWidth={1.9} />
          </span>
        </button>

        {/* Admin — folded in from the sidebar TAIL. Admin-gated by
            buildVisibleNav's /api/admin/access probe (adminItem is undefined
            for non-admins); the page + every /api/admin endpoint re-gate
            server-side, so this link never leaks access. */}
        {adminItem && (
          <Link
            href={adminItem.href}
            aria-label="Admin"
            title="Admin"
            className="hidden md:flex items-center justify-center relative flex-shrink-0"
            style={{
              minWidth: "var(--tap-min)",
              minHeight: "var(--tap-min)",
              background: "transparent",
              border: "none",
              color: "#C8D1E0",
              textDecoration: "none",
            }}
          >
            {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8). */}
            <span
              className="flex items-center justify-center rounded-[6px]"
              style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", transition: "background 150ms, color 150ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <Lock size={16} strokeWidth={1.9} />
            </span>
          </Link>
        )}

        {/* Help — dot badge while the current route's guide is unseen. Opens the
            help slideover (which itself links to /help + articles), so the
            sidebar TAIL's "Help & support" destination stays reachable. */}
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
          className="hidden sm:flex items-center justify-center flex-shrink-0"
          style={{
            minWidth: "var(--tap-min)",
            minHeight: "var(--tap-min)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
          title="Help"
        >
          {/* 32x32 chip inside a 44x44 hit area (WCAG 2.5.8); the unseen-guide dot
              rides the visible chip, not the larger hit area. */}
          <span
            className="flex items-center justify-center rounded-[6px] relative"
            style={{ width: 32, height: 32, background: "transparent", border: "1px solid transparent", color: "#C8D1E0", transition: "background 150ms, color 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#14253D"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
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
          </span>
        </button>

        {/* Account chip — real name/role, Profile · Settings · Sign out (Settings
            folded in from the sidebar TAIL). Compact avatar-only trigger; the
            menu opens downward from the top navbar. */}
        <div className="flex-shrink-0">
          <UserChipMenu collapsed placement="down" />
        </div>
      </div>

      {/* ── Row 2 · Primary nav ──────────────────────────────────────
          DO NOT re-inline this into the utility row above. That arrangement was
          tried and rejected: the top-level sections need their own row so they
          ALL stay visible at any desktop width, and the row above is already
          carrying the org switcher, Upload, and the account cluster. WP-26 cut
          the nav to four words, which shortens the row but does not free the
          ~540px the inline version wanted — the utility cluster is what fills
          it. md+ only; mobile uses the hamburger drawer. A right-edge fade cues
          horizontal scroll on the rare narrow-desktop overflow. */}
      <nav
        aria-label="Primary"
        className="hidden md:flex items-stretch px-3 sm:px-5"
        style={{
          height: 42,
          borderTop: "1px solid #14253D",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
          maskImage: "linear-gradient(to right, #000 calc(100% - 20px), transparent)",
        }}
      >
        {navItems.map((item) => (
          <TopNavLink key={item.href} item={item} active={isItemActive(pathname, item)} />
        ))}
      </nav>

      {/* ── Row 3 · Context row ──────────────────────────────────────
          The breadcrumb trail (desktop) / compact page label (mobile). Split
          out below the utility row to give the v2 two-row rhythm. It shows the
          navigation context — NOT a duplicate of the page's own H1 (pages render
          their own heading), so the shell never double-titles. A faint top rule
          separates the two rows. */}
      <div
        className={`flex items-center px-3 sm:px-5${loneCrumbRow ? " md:hidden" : ""}`}
        style={{ height: 38, borderTop: "1px solid #14253D" }}
      >
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
