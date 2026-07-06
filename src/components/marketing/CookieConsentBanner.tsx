"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCookieConsent } from "@/lib/cookie-consent";

export function CookieConsentBanner() {
  const [consent, setConsent] = useCookieConsent();

  // Render nothing until after hydration. The banner used to be SSR-rendered
  // (initial consent state is "unknown" on the server), which caused two real
  // bugs: (1) a click on "Accept analytics" during the hydration window hit a
  // button with no React handler attached yet — a silent no-op, so the banner
  // lingered after "accepting"; (2) returning visitors who had already chosen
  // saw the banner flash on every page load until the localStorage effect ran.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Publish the banner's occupied height as --plk-bottom-inset so bottom-pinned
  // primary action bars (upload/preview commit, mobile workshop send) can lift
  // clear of the fixed banner while it's visible. The banner is out of flow
  // (position: fixed) and reserves no layout space, so without this it overlaps
  // those bars on first visit. Reset to 0 whenever the banner is not shown —
  // no visual change once consent is chosen or when the banner never appears.
  const bannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const reset = () => root.style.setProperty("--plk-bottom-inset", "0px");
    const visible = mounted && consent === "unknown";
    if (!visible) {
      reset();
      return;
    }
    const el = bannerRef.current;
    if (!el) return;
    const apply = () => {
      // Occupied height from the viewport bottom = banner height + its 16px
      // bottom offset + a small breathing gap, measured live so it stays correct
      // across the compact-mobile / full-desktop variants and copy wrapping.
      const h = el.getBoundingClientRect().height;
      root.style.setProperty("--plk-bottom-inset", `${Math.ceil(h) + 16 + 10}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      reset();
    };
  }, [mounted, consent]);

  if (!mounted || consent !== "unknown") return null;

  return (
    <div
      ref={bannerRef}
      role="dialog"
      aria-label="Cookie consent"
      // Compact on mobile (tighter padding, smaller gap) so the banner stays
      // ~110px tall and doesn't cover sticky action bars; roomier on sm+.
      className="plk-cookie-banner flex flex-wrap items-center justify-between gap-2.5 p-3.5 sm:gap-4 sm:p-[18px_20px]"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 60,
        maxWidth: 720,
        margin: "0 auto",
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(11,26,47,0.12)",
      }}
    >
      {/* Compact copy on mobile — one short sentence + link. */}
      <p
        className="m-0 flex-1 basis-full text-[12.5px] leading-snug text-[#3D4A5C] sm:hidden"
      >
        Functional cookies only — optional analytics.{" "}
        <Link href="/privacy" style={{ color: "#2E8E3A" }}>Privacy Policy</Link>
      </p>
      {/* Full copy on sm+ (desktop variant unchanged). */}
      <p
        className="hidden sm:block"
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "#3D4A5C",
          flex: "1 1 320px",
        }}
      >
        ProcuLink uses functional cookies to keep you signed in, and optional analytics
        cookies to improve the product. We don&apos;t use advertising or cross-site tracking.{" "}
        <Link href="/privacy" style={{ color: "#2E8E3A" }}>See our Privacy Policy</Link>.
      </p>
      <div className="flex flex-1 gap-2 sm:flex-none">
        <button
          type="button"
          onClick={() => setConsent("functional-only")}
          className="flex-1 sm:flex-none"
          style={{
            background: "#FFFFFF",
            color: "#0B1A2F",
            border: "1px solid #C6CDDA",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => setConsent("analytics-allowed")}
          className="flex-1 sm:flex-none"
          style={{
            background: "#0B1A2F",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Accept analytics
        </button>
      </div>
    </div>
  );
}
