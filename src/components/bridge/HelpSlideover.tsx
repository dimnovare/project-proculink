"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { capture } from "@/lib/analytics";

interface Props {
  open:    boolean;
  onClose: () => void;
}

const CONTEXTUAL_LINKS: Record<string, { href: string; title: string }> = {
  "/upload":            { href: "/help/first-upload",    title: "Your first purchase order upload" },
  "/library/mappings":  { href: "/help/mapping-basics",  title: "PO field mapping basics" },
  "/library/suppliers": { href: "/help/delivery-config", title: "Configuring supplier delivery" },
  "/settings":          { href: "/help/billing-faq",     title: "Billing and plans FAQ" },
};

export function HelpSlideover({ open, onClose }: Props) {
  const pathname = usePathname();
  const contextual = Object.entries(CONTEXTUAL_LINKS).find(
    ([prefix]) => pathname?.startsWith(prefix),
  )?.[1];

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
