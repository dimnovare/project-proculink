"use client";

// Marketing nav — canonical navy bar: white wordmark, white links
// (How it works / Pricing / Security), blue "Get started free" CTA.

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { MarketingAuthLinks } from "@/components/marketing/MarketingAuthLinks";

// Clerk UI (UserButton + useUser) is the single heaviest dependency of the
// marketing pages (~140 kB chunk). It's code-split out of the first-load JS
// (ssr:false → fetched async after hydration, off the critical path). FOCUS
// SAFETY: the loading state is null and the static <MarketingAuthLinks /> is
// rendered as a persistent SIBLING below — the dynamic module renders nothing
// until a signed-in session is confirmed (then reports via onSignedInChange
// and we unmount the static links). A signed-out keyboard user focused on
// "Sign in"/"Start free" never has their DOM node swapped out from under them.
const MarketingClerkLinks = dynamic(
  () => import("@/components/marketing/MarketingClerkLinks").then((m) => m.MarketingClerkLinks),
  { ssr: false, loading: () => null },
);

const LINKS = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Formats",      href: "/formats"      },
  { label: "Pricing",      href: "/pricing"      },
  { label: "Security",     href: "/security"     },
];

export function MarketingNav() {
  const pathname = usePathname();
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [open, setOpen] = useState(false);
  // True once the lazily-loaded Clerk module confirms a signed-in session —
  // only then do the static signed-out links yield to the dashboard cluster.
  const [signedIn, setSignedIn] = useState(false);

  return (
    <nav
      className="on-navy sticky top-0 z-40 w-full"
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
                aria-current={active ? "page" : undefined}
                className={`px-3 py-1.5 rounded-[5px] text-[13.5px] font-medium transition-colors ${
                  active ? "text-white" : "text-[#9DB2CE] hover:text-white"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="min-w-2 flex-1" />

        {/* Static signed-out links persist (focus-safe); the dynamic Clerk
            module renders null until signed-in is confirmed, then swaps in. */}
        {!signedIn && <MarketingAuthLinks />}
        {clerkEnabled && <MarketingClerkLinks onSignedInChange={setSignedIn} />}

        {/* Mobile burger */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={open}
          className="sm:hidden flex items-center justify-center text-[20px]"
          style={{ width: 44, height: 44, color: "#FFFFFF", background: "transparent", border: 0 }}
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
              style={{ width: 44, height: 44, color: "#FFFFFF", background: "transparent", border: 0 }}
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
              style={{ background: "#297F34", color: "#FFFFFF" }}
            >
              Start free
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// MarketingClerkLinks (signed-in links + UserButton) lives in its own module —
// see the next/dynamic import at the top of this file. MarketingAuthLinks
// (signed-out links) was extracted to ./MarketingAuthLinks so both this nav and
// the lazy Clerk module can share it without a circular import.
