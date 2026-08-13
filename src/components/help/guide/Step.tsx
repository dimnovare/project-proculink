"use client";

import type { ReactNode } from "react";

/**
 * One numbered step in a guide.
 *
 * Renders a semantic <section> tagged with `data-guide-step` / `data-step-n` /
 * `data-step-title`. `GuideLayout` scans for those attributes after mount to
 * build the step-list sidebar and the mobile progress summary — so a guide
 * author adds a step by writing one `<Step>` and nothing else. No registry
 * entry, no duplicated titles.
 *
 * The vertical line running through the number badges is the product's link
 * signature (buyer blue): the guide is one path from one end to the other. It is
 * drawn per-step so a run of steps reads as continuous with no wrapper element,
 * and it is hidden on mobile where the badge sits inline with the title and
 * there is no gutter to draw in.
 */
export function Step({
  n,
  title,
  id,
  children,
}: {
  /** 1-based step number. Author-supplied so re-ordering is a visible edit. */
  n: number;
  title: string;
  /** Anchor id. Defaults to `step-<n>` — deep-linkable and stable. */
  id?: string;
  children: ReactNode;
}) {
  const anchor = id ?? `step-${n}`;

  return (
    <section
      id={anchor}
      data-guide-step=""
      data-step-n={n}
      data-step-title={title}
      className="relative pt-[26px] sm:pl-[46px]"
      style={{ scrollMarginTop: 88 }}
    >
      {/* Connector line — centred under the 32px badge (left 15 = 16 − 1). */}
      <span
        aria-hidden="true"
        className="absolute bottom-[-26px] left-[15px] top-[26px] hidden w-0.5 sm:block"
        style={{ background: "var(--gradient-line-buyer)", opacity: 0.4 }}
      />

      <h2
        className="m-0 flex items-start gap-3 sm:block"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.3,
          color: "var(--ink)",
        }}
      >
        <span
          aria-hidden="true"
          data-step-badge=""
          className="relative flex shrink-0 items-center justify-center sm:absolute sm:left-0 sm:top-[24px]"
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            background: "var(--surface)",
            border: "1.5px solid var(--brand-blue)",
            color: "var(--brand-blue-deep)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {n}
        </span>
        <span className="pt-[5px] sm:pt-0">{title}</span>
      </h2>

      <div className="guide-step-body">{children}</div>
    </section>
  );
}

/**
 * The failure branch of a step. Every step that can plausibly fail should carry
 * one — a guide that documents only the happy path sends the reader to support.
 */
export function IfThisFails({
  title = "If this fails",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="mt-4"
      style={{
        background: "var(--amber-soft)",
        borderLeft: "3px solid var(--amber)",
        borderRadius: "0 var(--radius-md) var(--radius-md) 0",
        padding: "12px 16px",
      }}
    >
      <p
        className="m-0 text-[12px] font-semibold uppercase"
        style={{ color: "var(--amber-text)", letterSpacing: "0.05em" }}
      >
        {title}
      </p>
      <div className="guide-callout-body">{children}</div>
    </div>
  );
}

/**
 * "You'll need" — the prerequisite box that opens a guide. Carries the
 * cross-section edge (buyer blue) used by primary cards elsewhere in the app.
 */
export function Prereqs({
  title = "You'll need",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="mt-6 overflow-hidden"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--brand-blue)",
        borderRadius: "0 var(--radius-md) var(--radius-md) 0",
        boxShadow: "var(--shadow-card)",
        padding: "14px 18px 16px",
      }}
    >
      <p
        className="m-0 text-[12px] font-semibold uppercase"
        style={{ color: "var(--brand-blue-deep)", letterSpacing: "0.05em" }}
      >
        {title}
      </p>
      <div className="guide-callout-body">{children}</div>
    </aside>
  );
}

/**
 * A plain result statement — "when this worked, you will see X". Quieter than a
 * failure callout, so a guide can confirm progress without shouting.
 */
export function Outcome({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-4 flex gap-2.5"
      style={{
        background: "var(--brand-green-soft)",
        borderLeft: "3px solid var(--brand-green)",
        borderRadius: "0 var(--radius-md) var(--radius-md) 0",
        padding: "11px 16px",
      }}
    >
      <span
        aria-hidden="true"
        className="shrink-0 pt-px text-[13px] font-semibold"
        style={{ color: "var(--brand-green-deep)" }}
      >
        ✓
      </span>
      <div className="guide-callout-body">{children}</div>
    </div>
  );
}
