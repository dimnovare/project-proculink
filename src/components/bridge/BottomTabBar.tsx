"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { buildVisibleNav, isItemActive, PHONE_TAB_HREFS, PINNED_ACTION_HREF, type SidebarNavItem } from "./BridgeSidebar";
import { DOCUMENTS_TAKE, documentsQuery, useDocumentEngine } from "@/hooks/useDocumentEngine";
import type { DocumentSummary } from "@/lib/api/documents";
import { documentStatus } from "@/lib/documentStatusManifest";

const MORE_ROOTS = ["/lookups", "/settings", "/admin", "/archive"];
const FULL_SCREEN = [/^\/flows\/new$/, /^\/flows\/[^/]+\/documents\/[^/]+$/, /^\/flows\/[^/]+\/outputs\/[^/]+\/advanced$/];

/** Review, setup and the Advanced view fill a phone screen: no tab bar there. */
export function isFullScreenStep(pathname: string | null): boolean {
  return pathname !== null && FULL_SCREEN.some((re) => re.test(pathname));
}

/** What the Documents tab shows by its icon. null = show nothing (none need you, or it is not known). */
export function needsYouBadge(docs: DocumentSummary[] | undefined, take: number): string | null {
  if (!docs) return null;
  const n = docs.filter((d) => documentStatus(d.status, d.statusReason).needsYou).length;
  if (n === 0) return null;
  return docs.length >= take ? `${n}+` : String(n);
}

const TAB = "relative flex min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[12.5px] text-ink-muted";

export function BottomTabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const pathname = usePathname();
  const engine = useDocumentEngine();
  const docs = useQuery({ ...documentsQuery, enabled: engine === "on" });
  if (isFullScreenStep(pathname)) return null;

  const badge = needsYouBadge(docs.data, DOCUMENTS_TAKE);
  const navItems = buildVisibleNav(false).main[0].items;
  const [first, second, third] = PHONE_TAB_HREFS.flatMap((h) => navItems.filter((i) => i.href === h));
  const moreActive = MORE_ROOTS.some((r) => pathname === r || !!pathname?.startsWith(r + "/"));
  const tab = (active: boolean) => `${TAB} ${active ? "font-semibold text-ink" : "font-medium"}`;
  const link = (item?: SidebarNavItem) => {
    if (!item) return null;
    const href = item.href;
    const active = !!pathname && isItemActive(pathname, item);
    const Icon = item.icon;
    const count = href === first?.href ? badge : null;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={count ? `${item.label}, ${count} need you` : undefined}
        className={tab(active)}
      >
        <span className="relative inline-flex">
          <Icon size={22} aria-hidden />
          {count && (
            <span
              aria-hidden
              className="absolute -right-2.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-text px-1 text-[12.5px] font-bold leading-none text-white"
            >
              {count}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      data-testid="tab-bar"
      className="plk-tabbar fixed inset-x-0 bottom-0 z-drawer grid grid-cols-5 items-end border-t border-border bg-surface pt-1 md:hidden"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      {link(first)}
      {link(second)}
      <Link
        href={PINNED_ACTION_HREF}
        aria-label="Add a document"
        className="mx-auto -mt-5 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand-blue text-white ring-4 ring-surface"
      >
        <Plus size={26} aria-hidden />
      </Link>
      {link(third)}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={onMore}
        className={tab(moreActive)}
      >
        <MoreHorizontal size={22} aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}
