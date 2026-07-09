"use client";

// Signed-in marketing nav links (Open the dashboard + UserButton). This is the
// ONLY marketing module that statically imports Clerk UI components — it is
// loaded via next/dynamic (ssr: false) from MarketingNav so the ~140 kB Clerk
// components chunk stays off the marketing pages' critical path. Until Clerk
// loads (or when signed out) it renders MarketingAuthLinks, which is exactly
// what the static prerender shows — so first paint is unchanged.

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { MarketingAuthLinks } from "./MarketingAuthLinks";

export function MarketingClerkLinks() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return <MarketingAuthLinks />;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link href="/bridge" className="text-[13px] font-semibold" style={{ color: "#2E8E3A" }}>
        <span className="hidden sm:inline">Open the dashboard →</span>
        <span className="sm:hidden">Dashboard</span>
      </Link>
      <UserButton />
    </div>
  );
}
