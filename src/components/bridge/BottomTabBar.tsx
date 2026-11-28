"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCopy } from "@/i18n/useCopy";
import { buildVisibleNav, currentPlace, navKey, PHONE_TAB_HREFS, PINNED_ACTION_HREF, type SidebarNavItem } from "./BridgeSidebar";
import { AddSheet } from "@/components/flows/AddSheet";
import { flowsQuery, needsYouQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { pageTotal } from "@/lib/pageTotal";
import { showBadge } from "@/lib/pwa/push";

const FULL_SCREEN = [/^\/flows\/new$/, /^\/flows\/[^/]+\/change-file$/, /^\/flows\/[^/]+\/documents\/[^/]+$/, /^\/flows\/[^/]+\/outputs\/[^/]+\/advanced$/];

/** Review, setup and the Advanced view fill a phone screen: no tab bar there. */
export function isFullScreenStep(pathname: string | null): boolean {
  return pathname !== null && FULL_SCREEN.some((re) => re.test(pathname));
}

/** What the Documents tab shows by its icon. null = show nothing (none need you, or it is not known). */
export function needsYouBadge(total: number | undefined): string | null {
  if (!total) return null;
  return total > 99 ? "99+" : String(total);
}

// "!" because the phone tap-floor rule in globals.css sets a 44px minimum with !important.
// No side padding: "Documents" (about 66px at 12px) fits its 75px cell on a 360px screen. The focus
// ring sits inside the target so the screen edge cannot clip it on the first and last tab.
const TAB = "relative flex !min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 text-[12.5px] max-[379px]:text-[12px] text-ink-muted focus-visible:[outline-offset:-3px]";
// Three places and the round Add: two tabs | Add | Settings over the right half. Weighted
// 5:5:4:10 so Add's column is the exact centre of the bar (and 60px wide at 360px).
const COLUMNS = "grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,4fr)_minmax(0,10fr)]";

export function BottomTabBar() {
  const pathname = usePathname();
  const engine = useDocumentEngine();
  const tenantReady = useTenantQueriesEnabled();
  // The same request and refresh as the Documents screen's needs-you number.
  const needsYou = useQuery({ ...needsYouQuery, enabled: tenantReady && engine === "on", refetchInterval: 60_000, refetchOnWindowFocus: true });
  // The app icon carries the same number.
  useEffect(() => showBadge(pageTotal(needsYou.data)), [needsYou.data]);
  const flows = useQuery({ ...flowsQuery, enabled: tenantReady });
  const [adding, setAdding] = useState(false);
  const { c } = useCopy("app");
  if (isFullScreenStep(pathname)) return null;

  const total = pageTotal(needsYou.data);
  const badge = needsYouBadge(total);
  const navItems = buildVisibleNav(false).main[0].items;
  const [first, second, third] = PHONE_TAB_HREFS.flatMap((h) => navItems.filter((i) => i.href === h));
  const link = (item?: SidebarNavItem) => {
    if (!item) return null;
    const href = item.href;
    const active = !!pathname && currentPlace(pathname) === href;
    const Icon = item.icon;
    const count = href === PHONE_TAB_HREFS[0] ? badge : null;
    const label = c(navKey(href), item.label);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={count ? `${label}, ${total === 1 ? c("needsYouOne", "1 needs you", { count: 1 }) : c("needsYouMany", `${total} need you`, { count: total! })}` : undefined}
        className={`${TAB} ${active ? "font-semibold !text-brand-blue-deep" : "font-medium"}`}
      >
        <span className="relative inline-flex">
          <Icon size={22} aria-hidden />
          {count && (
            <span
              aria-hidden
              className="absolute left-4 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-text px-1 text-[12.5px] font-bold leading-none text-white"
            >
              {count}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{label}</span>
      </Link>
    );
  };

  // -mt-5 + ring-4 = 24px above the bar: --plk-tabbar-raise in globals.css. Change the two together.
  const addClass = "mx-auto -mt-5 flex h-[52px] w-[52px] self-start items-center justify-center rounded-full bg-navy text-white ring-4 ring-surface focus-visible:rounded-full";

  return (
    <>
      <nav
        aria-label={c("mainNav", "Main")}
        data-testid="tab-bar"
        className={`plk-tabbar fixed inset-x-0 bottom-0 z-drawer grid ${COLUMNS} items-end border-t border-border bg-surface pt-1 md:hidden`}
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        {link(first)}
        {link(second)}
        {/* With a flow the round Add opens the sheet; with none (or not known yet) it stays the link to Upload (R15). */}
        {engine === "on" && !!flows.data?.length ? (
          <button type="button" aria-label={c("addDocument", "Add a document")} aria-haspopup="dialog" aria-expanded={adding} onClick={() => setAdding(true)}
            aria-current={pathname === PINNED_ACTION_HREF ? "page" : undefined} className={addClass}>
            <Plus size={26} aria-hidden />
          </button>
        ) : (
          <Link
            href={PINNED_ACTION_HREF}
            aria-label={c("addDocument", "Add a document")}
            aria-current={pathname === PINNED_ACTION_HREF ? "page" : undefined}
            className={addClass}
          >
            <Plus size={26} aria-hidden />
          </Link>
        )}
        {link(third)}
      </nav>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </>
  );
}
