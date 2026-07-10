"use client";

// Signed-out marketing nav links (Sign in / Start free). Extracted from
// MarketingNav so it can double as the SSR/loading fallback for the
// lazily-loaded Clerk links — keeping the Clerk UI bundle out of the
// marketing pages' first-load JS without changing what first paint shows.

import Link from "next/link";

export function MarketingAuthLinks() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link href="/sign-in" className="hidden text-[13.5px] font-medium sm:inline" style={{ color: "#C5D2E4" }}>
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold sm:px-4 sm:text-[13px]"
        style={{ height: 34, background: "#297F34", color: "#FFFFFF", border: "none" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#1E6D29"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#297F34"; }}
      >
        <span className="hidden sm:inline">Start free</span>
        <span className="sm:hidden">Start</span>
      </Link>
    </div>
  );
}
