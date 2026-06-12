"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { capture } from "@/lib/analytics";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { matchGuide, replaySectionGuide, resolveGuideText } from "@/lib/section-guides";
import { SectionGuideBody } from "./SectionGuide";

interface Props {
  open:    boolean;
  onClose: () => void;
}

// Ordered route → article map; FIRST match wins, so more specific matchers
// (supplier DETAIL page) sit above their prefix parents (supplier list).
const CONTEXTUAL_LINKS: Array<{
  match: (path: string) => boolean;
  href: string;
  title: string;
}> = [
  { match: (p) => p.startsWith("/upload"),                      href: "/help/first-upload",    title: "Your first purchase order upload" },
  { match: (p) => p.startsWith("/inbox"),                       href: "/help/item-codes",      title: "Supplier item codes, catalogs, and mappings" },
  { match: (p) => p.startsWith("/library/mappings"),            href: "/help/mapping-basics",  title: "PO field mapping basics" },
  // Supplier DETAIL (where the Delivery/Catalog tabs live) → delivery setup.
  { match: (p) => /^\/library\/suppliers\/.+/.test(p),          href: "/help/delivery-setup",  title: "Setting up delivery and test-fire" },
  { match: (p) => p.startsWith("/library/suppliers"),           href: "/help/delivery-config", title: "Configuring supplier delivery" },
  { match: (p) => p.startsWith("/settings"),                    href: "/help/billing-faq",     title: "Billing and plans FAQ" },
];

export function HelpSlideover({ open, onClose }: Props) {
  const pathname = usePathname();
  const { labels } = useOrderDirection();
  const guide = matchGuide(pathname);
  const contextual = pathname
    ? CONTEXTUAL_LINKS.find((l) => l.match(pathname))
    : undefined;

  useEffect(() => {
    if (open) capture("help_slideover_opened", { route: pathname });
  }, [open, pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Help"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(11,26,47,0.32)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(380px, 100%)",
          background: "#FFFFFF",
          height: "100%",
          padding: "24px 22px",
          boxShadow: "-12px 0 30px rgba(11,26,47,0.12)",
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: 18,
              fontWeight: 600,
              color: "#0B1A2F",
              margin: 0,
            }}
          >
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              color: "var(--ink-faint)",
              padding: 4,
            }}
          >
            ×
          </button>
        </header>

        {/* Current screen's section guide — same registry/renderer as the
            inline SectionGuide card, in compact form. */}
        {guide && (
          <section
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 18,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              This screen
            </p>
            <h3
              style={{
                margin: "6px 0 8px",
                fontSize: 14,
                fontWeight: 600,
                color: "#0B1A2F",
                lineHeight: 1.3,
              }}
            >
              {resolveGuideText(guide.title, labels)}
            </h3>
            <SectionGuideBody
              guide={guide}
              labels={labels}
              compact
              onNavigate={onClose}
            />
            <button
              type="button"
              onClick={() => {
                // Clear the seen key + expand the inline card, then close so
                // the user actually sees it on the page.
                replaySectionGuide(guide.route);
                onClose();
              }}
              style={{
                marginTop: 10,
                minHeight: 34,
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #E2E6EE",
                background: "#FFFFFF",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--ink-muted)",
                cursor: "pointer",
              }}
            >
              Replay intro
            </button>
          </section>
        )}

        {contextual && (
          <section
            style={{
              background: "#F6F7FA",
              border: "1px solid #E2E6EE",
              borderLeft: "3px solid #2E8E3A",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 18,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              For this page
            </p>
            <Link
              href={contextual.href}
              onClick={onClose}
              style={{
                display: "block",
                marginTop: 6,
                fontSize: 14,
                fontWeight: 600,
                color: "#0B1A2F",
                textDecoration: "none",
              }}
            >
              {contextual.title}
            </Link>
          </section>
        )}

        <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link
            href="/help"
            onClick={onClose}
            style={{
              padding: "10px 12px",
              border: "1px solid #E2E6EE",
              borderRadius: 6,
              fontSize: 14,
              color: "#0B1A2F",
              textDecoration: "none",
            }}
          >
            Open help docs →
          </Link>
          <Link
            href="/support"
            onClick={onClose}
            style={{
              padding: "10px 12px",
              border: "1px solid #E2E6EE",
              borderRadius: 6,
              fontSize: 14,
              color: "#0B1A2F",
              textDecoration: "none",
            }}
          >
            Contact support
          </Link>
          <Link
            href="/support#report-a-bug"
            onClick={onClose}
            style={{
              padding: "10px 12px",
              border: "1px solid #E2E6EE",
              borderRadius: 6,
              fontSize: 14,
              color: "#0B1A2F",
              textDecoration: "none",
            }}
          >
            Report a bug
          </Link>
        </nav>
      </aside>
    </div>
  );
}
