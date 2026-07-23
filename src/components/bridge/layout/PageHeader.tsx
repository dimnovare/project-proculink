import * as React from "react";
import { HubEyebrow } from "./HubEyebrow";

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
  /**
   * Founder rule (2026-07): the active tab in the navy topbar IS the page
   * name — a page never re-announces its own title below it. Pages whose title
   * repeats their active topbar label (primary nav row: BridgeTopbar
   * `TopNavLink` with aria-current; hub routes: the HubTabs strip BridgeTopbar
   * renders in its context row via useHubRow) set this to keep the h1 for
   * screen readers / heading queries while removing the visual title block.
   * The sub + actions survive as a compact row; the HubEyebrow is skipped
   * because on every hub route the topbar context row already leads with the
   * same hub label (BridgeTopbar useHubRow prefixes HUB_LABELS[hub]).
   */
  titleHidden?: boolean;
};

export function PageHeader({ title, sub, actions, className, titleHidden }: PageHeaderProps) {
  if (titleHidden) {
    return (
      <>
        <h1 className="sr-only">{title}</h1>
        {(sub || actions) && (
          <div
            className={[
              "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
              "mb-4 sm:mb-5",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {sub ? (
              <p
                className="min-w-0"
                style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-muted)", margin: 0 }}
              >
                {sub}
              </p>
            ) : (
              // Left spacer so justify-between keeps a lone actions cluster right-aligned.
              <span aria-hidden />
            )}
            {actions && (
              <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:justify-end">
                {actions}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

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
        {/* Hub eyebrow — names the hub this page belongs to (derived from the
            route inside HubEyebrow, so no page file changes). Renders nothing
            on non-hub routes. */}
        <HubEyebrow />
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
