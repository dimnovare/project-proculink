"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";

const LINKS = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing",      href: "/pricing"      },
];

export function MarketingNav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky top-0 z-40 w-full flex items-center gap-6 px-8"
      style={{
        height: 58,
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #E2E6EE",
      }}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5">
        <ProcuLinkMark size={22} />
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 15,
            fontWeight: 700,
            color: "#0B1A2F",
            letterSpacing: "-0.01em",
          }}
        >
          ProcuLink
        </span>
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-1 ml-4">
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

      <div className="flex-1" />

      {/* CTA */}
      <Link
        href="/sign-in"
        className="text-[13px] font-medium transition-colors"
        style={{ color: "#56627A" }}
      >
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="flex items-center rounded-[6px] px-4 text-[13px] font-semibold transition-all"
        style={{
          height: 34,
          background: "#0B1A2F",
          color: "#FFFFFF",
          border: "none",
          boxShadow: "0 1px 3px rgba(11,26,47,0.18)",
        }}
      >
        Get started free →
      </Link>
    </nav>
  );
}
