import * as React from "react";

/* =====================================================================
   PageShell — canonical in-app page wrapper.

   Replaces the per-page `*-shell` / `work-inner` divs. Renders a
   full-height scroll area on the page canvas (var(--bg)) with a centered
   container, canonical responsive gutter, and vertical rhythm.

   Source of truth: docs/design-system/11-unified-page-rules.md

   Usage:
     <PageShell>            // narrow (forms, single-column) — 1040px
     <PageShell variant="wide">  // tables / dashboards — 1480px

   Server-component safe (no hooks / handlers).
   ===================================================================== */

type PageShellProps = {
  /** Content max-width. 'narrow' = forms/single-column, 'wide' = tables/dashboards. */
  variant?: "narrow" | "wide";
  children: React.ReactNode;
  className?: string;
};

export function PageShell({ variant = "narrow", children, className }: PageShellProps) {
  const maxWidth =
    variant === "wide" ? "var(--container-wide)" : "var(--container-narrow)";

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-auto"
      style={{ background: "var(--bg)" }}
    >
      {/* Canonical gutter ramp: 16 (base) → 24 (sm) → 34 (lg); vertical 20 → 28. */}
      <div
        className={[
          "mx-auto w-full flex-1 min-h-0 px-4 sm:px-6 lg:px-[34px] py-5 sm:py-7",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ maxWidth }}
      >
        {children}
        {/* Reserves scroll room equal to the fixed cookie-consent banner's height
            while it's visible (--plk-bottom-inset, set by CookieConsentBanner),
            so bottom-anchored content and sticky CTAs on any PageShell page clear
            the banner instead of hiding behind it. Collapses to 0 once consent is
            chosen or when the banner never shows — no layout change otherwise. */}
        <div aria-hidden style={{ height: "var(--plk-bottom-inset, 0px)", flex: "0 0 auto" }} />
      </div>
    </div>
  );
}

export default PageShell;
