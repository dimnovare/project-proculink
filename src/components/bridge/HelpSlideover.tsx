"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { capture } from "@/lib/analytics";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import {
  matchGuide,
  resolveGuideText,
  type GuidePartyLabels,
  type SectionGuideEntry,
} from "@/lib/section-guides";

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

// ─── Section guide body ──────────────────────────────────────────────────────
// Renders one registry entry's purpose / bullets / "Start here" line. The help
// slideover is the ONLY home for guide content (the inline first-visit card was
// removed); guide hrefs that are bare "?tab=…" resolve against the CURRENT
// pathname, which is correct because the slideover always renders on the page
// the guide describes.

interface SectionGuideBodyProps {
  guide: SectionGuideEntry;
  labels: GuidePartyLabels;
  /** Called when a guide link is followed (the slideover closes itself). */
  onNavigate?: () => void;
}

function SectionGuideBody({ guide, labels, onNavigate }: SectionGuideBodyProps) {
  const t = (s: string) => resolveGuideText(s, labels);
  const bodySize = 12;

  const linkStyle: React.CSSProperties = {
    color: "var(--brand-blue-deep)",
    fontWeight: 500,
    textDecoration: "none",
  };

  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: bodySize + 0.5,
          lineHeight: 1.5,
          color: "var(--ink-muted)",
        }}
      >
        {t(guide.purpose)}
      </p>

      <p
        style={{
          margin: "10px 0 5px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        What you can do here
      </p>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {guide.bullets.map((bullet, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "2.5px 0",
              fontSize: bodySize,
              lineHeight: 1.5,
              color: "var(--ink-muted)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--border-strong)",
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            {bullet.href ? (
              <Link
                href={bullet.href}
                onClick={onNavigate}
                className="hover:underline"
                style={linkStyle}
              >
                {t(bullet.text)}
              </Link>
            ) : (
              <span>{t(bullet.text)}</span>
            )}
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--brand-green-soft)",
          fontSize: bodySize,
          lineHeight: 1.5,
          color: "var(--ink)",
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--brand-green-deep)" }}>
          Start here:
        </span>{" "}
        {guide.firstStep.href ? (
          <Link
            href={guide.firstStep.href}
            onClick={onNavigate}
            className="hover:underline"
            style={{ ...linkStyle, color: "var(--ink)", fontWeight: 600 }}
          >
            {t(guide.firstStep.text)}
          </Link>
        ) : (
          <span>{t(guide.firstStep.text)}</span>
        )}
      </div>
    </div>
  );
}

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

        {/* Current screen's section guide — the only home for guide content. */}
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
              onNavigate={onClose}
            />
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
