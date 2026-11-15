"use client";

import { useQuery } from "@tanstack/react-query";
import { HelpCircle, Lock, Menu, Search, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkAdminAccess, getBillingStatus, isApiMockMode } from "@/lib/api-client";
import { matchGuide } from "@/lib/section-guides";

/** The unseen-guide dot's storage key; it goes with the dot (plan 14.11, R4). */
const guideSeenKey = (route: string) => `plk-guide-seen:${route}`;
import { planDisplayName } from "@/lib/plans";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrganization } from "@clerk/nextjs";
import { CommandPalette } from "./CommandPalette";
import { ProcuLinkMark } from "./DSPrimitives";
import { HelpSlideover } from "./HelpSlideover";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserChipMenu } from "./UserChipMenu";
import { buildVisibleNav, isItemActive, PINNED_ACTION_HREF } from "./BridgeSidebar";

interface BridgeTopbarProps {
  onMenuClick?: () => void;
  /** The navigation panel the menu button opens is open. */
  menuOpen?: boolean;
}

// ─── Page links (top bar, lg+) ───────────────────────────────────────────────
// Structure, gating and active state are REUSED from BridgeSidebar
// (buildVisibleNav / isItemActive) so the bar and the navigation panel can
// never drift.

/**
 * The page links for the top bar. Groups are flattened to one ordered list.
 * Returns the admin-gated `tail` items so the caller can place Admin in the
 * right cluster without re-deriving the gate.
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

/** A 44px icon control on navy (WCAG 2.5.8 hit area). */
const ICON_BUTTON = "flex size-11 shrink-0 items-center justify-center rounded-[6px] text-navy-text transition-colors hover:bg-navy-surface hover:text-white";

export function BridgeTopbar({ onMenuClick, menuOpen }: BridgeTopbarProps) {
  const pathname = usePathname();
  const { items: navItems, tail: navTail } = useTopNav();
  const { orgName, planLabel, activePlan } = useWorkspaceCardData();
  const adminItem = navTail.find((t) => t.href === "/admin");
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
    <header className="on-navy relative flex flex-shrink-0 flex-col bg-navy pb-0.5">
      {/* One row at every width. It fits because the five page links only show
          from 1024px (`lg`), "Upload" is one word, and the workspace switcher is
          the one item that gives way: it alone may shrink (its name is cut with an
          ellipsis, at most 220px); everything else is `shrink-0`. 768 to 1023 puts
          a menu button at the end instead of the links; phones move between pages
          with the bottom tab bar. The row (height, and every item ending inside
          the screen, also with a 60-character workspace name) is measured at eight
          widths by tests/e2e/shell.spec.ts. The header's 2px bottom padding is
          where the gradient line sits, BELOW the row, so the current link's white
          line stays visible above it. */}
      <div data-testid="topbar-row" className="flex h-[52px] items-center gap-2 px-3 sm:px-5 md:h-14 xl:gap-3">
        <Link href="/documents" aria-label="ProcuLink, go to Documents" className="flex shrink-0 items-center gap-2 text-white no-underline">
          <ProcuLinkMark size={24} mono />
          <span className="hidden font-display text-[16px] font-bold tracking-[-0.015em] md:inline">ProcuLink</span>
        </Link>

        <div className="min-w-0">
          <OrgSwitcher compact orgName={orgName} planLabel={planLabel} activePlan={activePlan} />
        </div>

        <nav aria-label="Main" data-testid="topbar-nav" className="hidden shrink-0 self-stretch lg:flex">
          {navItems.map((item) => {
            const active = isItemActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center whitespace-nowrap border-y-2 border-t-transparent px-2.5 text-[14.5px] no-underline transition-colors xl:px-3 ${active ? "border-b-white font-semibold text-white" : "border-b-transparent font-medium text-navy-text hover:text-white"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Demo-mode badge — gated on the SAME isApiMockMode flag the data layer
            uses, so the badge and the actual mock-data mode can never diverge.
            Full pill from sm up; a compact dot-only pill on mobile. `ml-auto`
            starts the right control cluster. */}
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
          // Anchor the right cluster to the row's end even when the demo badge is absent.
          <span className="ml-auto" aria-hidden />
        )}

        {/* Upload — the pinned create action (the sidebar's PINNED_ACTION_HREF).
            Blue = buyer/source action. Phones reach it through the tab bar's Add. */}
        <Link
          href={PINNED_ACTION_HREF}
          aria-label="Upload a document"
          className="hidden h-10 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-brand-blue px-[13px] text-[13px] font-semibold text-white no-underline transition-colors hover:bg-brand-blue-deep md:inline-flex"
        >
          <Upload size={15} strokeWidth={2} aria-hidden />
          <span>Upload</span>
        </Link>

        {/* Search — the one trigger for the command palette (Ctrl/Cmd K). */}
        <button type="button" aria-label="Search" title="Search, Ctrl K" onClick={() => setPaletteOpen(true)} className={ICON_BUTTON}>
          <Search size={17} strokeWidth={1.9} aria-hidden />
        </button>

        {/* Admin — folded in from the sidebar TAIL. Admin-gated by
            buildVisibleNav's /api/admin/access probe (adminItem is undefined
            for non-admins); the page + every /api/admin endpoint re-gate
            server-side, so this link never leaks access. */}
        {adminItem && (
          <Link href={adminItem.href} aria-label="Admin" title="Admin" className={`${ICON_BUTTON} max-md:hidden`}>
            <Lock size={16} strokeWidth={1.9} aria-hidden />
          </Link>
        )}

        {/* Help — dot badge while the current route's guide is unseen. Opens the
            help slideover (which itself links to /help + articles). */}
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
          className={`${ICON_BUTTON} relative`}
          title="Help"
        >
          <HelpCircle size={17} strokeWidth={1.9} aria-hidden />
          {guideUnseen && (
            <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full border-[1.5px] border-navy bg-amber" />
          )}
        </button>

        {/* Account chip — real name/role, Profile · Settings · Sign out. Phones
            reach Settings through the tab bar's More. */}
        <div className="hidden shrink-0 md:block">
          <UserChipMenu collapsed placement="down" />
        </div>

        {/* Tablets (768 to 1023): the page links do not fit, so the last item
            opens the navigation panel instead. */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-expanded={!!menuOpen}
          className="hidden size-11 shrink-0 items-center justify-center rounded-[7px] border border-navy-border bg-navy-surface text-navy-text md:flex lg:hidden"
        >
          <Menu size={18} strokeWidth={2.2} aria-hidden />
        </button>
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
