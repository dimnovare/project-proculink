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
          <ProcuLinkMark size={26} />
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

      {/* Mobile menu — fixed full-screen overlay so hero is fully covered */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col sm:hidden"
          style={{ background: "#0B1A2F" }}
        >
          {/* Top bar row: logo + close button */}
          <div
            className="flex items-center justify-between px-4"
            style={{ height: 58, borderBottom: "1px solid #1B2D49" }}
          >
            <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
              <ProcuLinkMark size={24} />
              <span
                style={{
                  fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
                  fontSize: 18, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em",
                }}
              >
                ProcuLink
              </span>
            </Link>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              style={{ width: 34, height: 34, color: "#FFFFFF", background: "transparent", border: 0 }}
              className="flex items-center justify-center text-xl"
            >
              ✕
            </button>
          </div>

          {/* Nav links */}
          <div className="flex flex-col px-4 pt-4 gap-1">
            {LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-[7px] px-3 py-4 text-[16px] font-medium"
                style={{ color: "#C5D2E4", borderBottom: "1px solid #1B2D49" }}
              >
                {label}
              </Link>
            ))}
            <Link
              href="/sign-in"
              onClick={() => setOpen(false)}
              className="rounded-[7px] px-3 py-4 text-[16px] font-medium"
              style={{ color: "#C5D2E4", borderBottom: "1px solid #1B2D49" }}
            >
              Sign in
            </Link>
          </div>

          {/* CTA */}
          <div className="px-4 pt-6">
            <Link
              href="/sign-up"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center rounded-[6px] py-3 text-[15px] font-semibold w-full"
              style={{ background: "#28C55E", color: "#FFFFFF" }}
            >
              Start free
            </Link>
          </div>
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
      <Link href="/bridge" className="text-[13px] font-semibold" style={{ color: "#28C55E" }}>
        <span className="hidden sm:inline">Open the dashboard →</span>
        <span className="sm:hidden">Dashboard</span>
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
        style={{ height: 34, background: "#28C55E", color: "#FFFFFF", border: "none" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#1DAF50"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#28C55E"; }}
      >
        <span className="hidden sm:inline">Start free</span>
        <span className="sm:hidden">Start</span>
      </Link>
    </div>
  );
}
