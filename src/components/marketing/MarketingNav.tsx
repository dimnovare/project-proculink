"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

const LINKS = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing",      href: "/pricing"      },
];

export function MarketingNav() {
  const pathname = usePathname();
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <nav
      className="sticky top-0 z-40 flex w-full items-center gap-3 px-4 sm:gap-6 sm:px-8"
      style={{
        height: 58,
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #E2E6EE",
      }}
    >
      {/* Logo */}
      <Link href="/" className="flex min-w-0 items-center gap-3">
        <ProcuLinkMark size={30} />
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            color: "#0B1A2F",
            letterSpacing: "-0.02em",
          }}
        >
          ProcuLink
        </span>
      </Link>

      {/* Nav links */}
      <div className="ml-2 hidden items-center gap-1 sm:ml-4 sm:flex">
        {LINKS.map(({ label, href }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-[5px] text-[13px] font-medium transition-colors"
              style={{
                color: active ? "#0B1A2F" : "#56627A",
                background: active ? "#F0F2F7" : "transparent",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="min-w-2 flex-1" />

      {clerkEnabled ? <MarketingClerkLinks /> : <MarketingAuthLinks />}
    </nav>
  );
}

function MarketingClerkLinks() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded || !isSignedIn) {
    return <MarketingAuthLinks />;
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link
        href="/bridge"
        className="text-[13px] font-semibold transition-colors"
        style={{ color: "#0B1A2F" }}
      >
        <span className="hidden sm:inline">Open bridge</span>
        <span className="sm:hidden">Bridge</span>
      </Link>
      <UserButton />
    </div>
  );
}

function MarketingAuthLinks() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link
        href="/sign-in"
        className="hidden text-[13px] font-medium transition-colors sm:inline"
        style={{ color: "#56627A" }}
      >
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="flex items-center rounded-[6px] px-3 text-[12px] font-semibold transition-all sm:px-4 sm:text-[13px]"
        style={{
          height: 34,
          background: "#0B1A2F",
          color: "#FFFFFF",
          border: "none",
          boxShadow: "0 1px 3px rgba(11,26,47,0.18)",
        }}
      >
        <span className="hidden sm:inline">Get started free →</span>
        <span className="sm:hidden">Start →</span>
      </Link>
    </div>
  );
}
