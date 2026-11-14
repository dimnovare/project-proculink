import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/* =====================================================================
   PageHeader — the ONE canonical page-title row.

   Every page names itself: a visible title, one helper line saying what
   the page is, and, when the page sits under another one, the way back
   above the title. Optional actions sit on the right and wrap under the
   title on phones.

   Server-component safe (no hooks / handlers).
   ===================================================================== */

type PageHeaderProps = {
  title: string;
  /** The one helper line under the title: what this page is. 15px. */
  sub?: React.ReactNode;
  /** The page this one sits under. Drawn above the title as a link with a left chevron and `label`; announced as "Back to {label}". */
  back?: { href: string; label: string };
  /** Right side, aligned to the bottom of the title block; wraps under it on phones. */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, sub, back, actions, className }: PageHeaderProps) {
  return (
    <div
      className={["mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            aria-label={`Back to ${back.label}`}
            className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand-blue sm:min-h-[40px]"
          >
            <ChevronLeft size={18} aria-hidden />
            {back.label}
          </Link>
        )}
        <h1
          className="m-0 break-words font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink [overflow-wrap:anywhere] sm:text-[30px]"
        >
          {title}
        </h1>
        {sub && (
          <p className="mt-1.5 text-[15px] leading-[1.45]" style={{ color: "var(--ink-muted)" }}>
            {sub}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}

export default PageHeader;
