"use client";

// Signed-in marketing nav links (Open the dashboard + UserButton). This is the
// ONLY marketing module that statically imports Clerk UI components — it is
// loaded via next/dynamic (ssr: false) from MarketingNav so the ~140 kB Clerk
// components chunk stays out of the marketing pages' first-load JS (it is
// fetched async after hydration, off the critical path).
//
// FOCUS SAFETY: this component renders NOTHING until a signed-in session is
// confirmed. The parent keeps the static signed-out <MarketingAuthLinks /> as
// a persistent SIBLING and only unmounts it when we report signed-in via
// onSignedInChange — so a signed-out keyboard user's focus on "Sign in" /
// "Start free" is never dropped by a fallback→loaded subtree swap (those DOM
// nodes are simply never replaced). The swap only happens when the content
// GENUINELY changes to the dashboard links.

import { useEffect } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";

export function MarketingClerkLinks({
  onSignedInChange,
}: {
  onSignedInChange: (signedIn: boolean) => void;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const signedIn = Boolean(isLoaded && isSignedIn);

  useEffect(() => {
    onSignedInChange(signedIn);
  }, [signedIn, onSignedInChange]);

  if (!signedIn) return null;
  return (
    <div className="flex shrink-0 items-center gap-3">
      {/* #5FC06B (--brand-green-bright) not #2E8E3A: this 13px link sits on the
          NAVY nav bar (#0B1A2F), where green is 4.1948:1. green-deep would go
          the wrong way on a dark ground (2.7220:1); green-bright is 7.6795:1. */}
      <Link href="/bridge" className="text-[13px] font-semibold" style={{ color: "#5FC06B" }}>
        <span className="hidden sm:inline">Open the dashboard →</span>
        <span className="sm:hidden">Dashboard</span>
      </Link>
      <UserButton />
    </div>
  );
}
