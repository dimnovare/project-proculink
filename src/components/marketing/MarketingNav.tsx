"use client";

// Marketing nav — canonical navy bar: white wordmark, white links
// (How it works / Pricing / Security), blue "Get started free" CTA.

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

const LINKS = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing",      href: "/pricing"      },
  { label: "Security",     href: "/security"     },
];

export function MarketingNav() {
  const pathname = usePathname();
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [open, setOpen] = useState(false);

  return (
    <nav
      className="sticky top-0 z-40 w-full"
      style={{ background: "#0B1A2F", borderBottom: "1px solid #1B2D49" }}
    >
      <div className="flex items-center gap-3 px-4 sm:gap-6 sm:px-8" style={{ height: 58 }}>
        {/* Logo */}
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <ProcuLinkMark size={26} mono />
          <span
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: 18, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em",
            }}
          >
            ProcuLink
          </span>
        </Link>

        {/* Links */}
        <div className="ml-2 hidden items-center gap-1 sm:ml-4 sm:flex">
          {LINKS.map(({ label, href }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="px-3 py-1.5 rounded-[5px] text-[13.5px] font-medium transition-colors"
                style={{ color: active ? "#FFFFFF" : "#9DB2CE" }}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="min-w-2 flex-1" />

        {clerkEnabled ? <MarketingClerkLinks /> : <MarketingAuthLinks />}

        {/* Mobile burger */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          className="sm:hidden flex items-center justify-center"
          style={{ width: 34, height: 34, color: "#FFFFFF", background: "transparent", border: 0 }}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="sm:hidden px-4 pb-4 flex flex-col gap-1" style={{ borderTop: "1px solid #1B2D49" }}>
          {LINKS.map(({ label, href }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="py-2 text-[14px]" style={{ color: "#9DB2CE" }}>{label}</Link>
          ))}
          <Link href="/sign-in" onClick={() => setOpen(false)} className="py-2 text-[14px]" style={{ color: "#9DB2CE" }}>Sign in</Link>
        </div>
      )}
    </nav>
  );
}

function MarketingClerkLinks() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return <MarketingAuthLinks />;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link href="/bridge" className="text-[13px] font-semibold" style={{ color: "#6BA5F0" }}>
        <span className="hidden sm:inline">Open the bridge →</span>
        <span className="sm:hidden">Bridge</span>
      </Link>
      <UserButton />
    </div>
  );
}

function MarketingAuthLinks() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link href="/sign-in" className="hidden text-[13.5px] font-medium sm:inline" style={{ color: "#C5D2E4" }}>
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold sm:px-4 sm:text-[13px]"
        style={{ height: 34, background: "#1E66C9", color: "#FFFFFF", border: "none" }}
      >
        <span className="hidden sm:inline">Get started free →</span>
        <span className="sm:hidden">Start →</span>
      </Link>
    </div>
  );
}
