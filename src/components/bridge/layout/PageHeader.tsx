import * as React from "react";

/* =====================================================================
   PageHeader — the ONE canonical page-title row.

   Replaces inline <h1 style={...}> blocks. One display size, one
   subtitle style, one optional right-aligned actions slot that wraps
   below the title on mobile.

   Source of truth: docs/design-system/11-unified-page-rules.md

   Usage:
     <PageHeader title="Suppliers" sub="Who you send orders to" actions={<Button …/>} />

   Server-component safe (no hooks / handlers).
   ===================================================================== */

type PageHeaderProps = {
  title: string;
  /** Subtitle line. Accepts inline JSX (status dots, counts) — rendered inside the canonical 13px muted paragraph. */
  sub?: React.ReactNode;
  /** Right-aligned actions (buttons, filters). Wraps to a new line on mobile. */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, sub, actions, className }: PageHeaderProps) {
  return (
    <div
      className={[
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        "mb-5 sm:mb-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        <h1
          className="text-[28px] sm:text-[30px]"
          style={{
            fontFamily:
              "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            margin: 0,
            color: "var(--ink)",
          }}
        >
          {title}
        </h1>
        {sub && (
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              color: "var(--ink-muted)",
              margin: "5px 0 0",
            }}
          >
            {sub}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
