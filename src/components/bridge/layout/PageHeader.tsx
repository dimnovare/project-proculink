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
  back?: { href: string; label: string; /** A client page's own click, e.g. to save what is waiting before leaving. */ onClick?: React.MouseEventHandler<HTMLAnchorElement> };
  /** Right side, aligned to the bottom of the title block; wraps under it on phones. */
  actions?: React.ReactNode;
  /** A small control drawn right after the title, on its line (e.g. a rename pen). Absent: the title renders as before. */
  titleAction?: React.ReactNode;
  /** A working screen (a document beside its values): from lg, one row that stays at the top while the page scrolls,
   *  so the page's main button is always in reach. Below lg it stacks like the ordinary header, with smaller type. */
  compact?: boolean;
  className?: string;
};

export function PageHeader({ title, sub, back, actions, titleAction, compact, className }: PageHeaderProps) {
  if (compact) {
    return (
      <div
        className={["mb-4 flex flex-col gap-2 lg:sticky lg:top-0 lg:z-10 lg:-mt-7 lg:flex-row lg:items-center lg:gap-4 lg:border-b lg:border-border lg:bg-[var(--bg)] lg:py-2", className]
          .filter(Boolean)
          .join(" ")}
      >
        {back && (
          <Link
            href={back.href}
            onClick={back.onClick}
            aria-label={`Back to ${back.label}`}
            className="inline-flex min-h-[44px] flex-none items-center gap-1 self-start text-[14px] font-semibold text-brand-blue hover:underline lg:min-h-[40px] lg:self-auto"
          >
            <ChevronLeft size={18} aria-hidden />
            <span className="[overflow-wrap:anywhere]">{back.label}</span>
          </Link>
        )}
        {/* The name shrinks last: from lg the line beside it gives way first, so the page always says what it is (V-01). */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-baseline lg:gap-3">
          <h1 title={title} className="m-0 font-display text-[22px] font-semibold leading-[1.15] tracking-[-0.01em] text-ink [overflow-wrap:anywhere] lg:max-w-full lg:shrink-0 lg:truncate lg:text-[19px]">
            {title}
          </h1>
          {sub && <p className="m-0 text-[13px] leading-[1.45] text-ink-muted [overflow-wrap:anywhere] lg:min-w-0 lg:truncate">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 lg:flex-shrink-0 lg:justify-end">{actions}</div>}
      </div>
    );
  }
  const h1 = (
    <h1
      className="m-0 break-words font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink [overflow-wrap:anywhere] sm:text-[30px]"
    >
      {title}
    </h1>
  );
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
            onClick={back.onClick}
            aria-label={`Back to ${back.label}`}
            className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand-blue hover:underline sm:min-h-[40px]"
          >
            <ChevronLeft size={18} aria-hidden />
            <span className="[overflow-wrap:anywhere]">{back.label}</span>
          </Link>
        )}
        {titleAction ? <div className="flex min-w-0 items-center gap-1">{h1}{titleAction}</div> : h1}
        {sub && (
          <p className="mt-1.5 text-[15px] leading-[1.45] text-ink-muted [overflow-wrap:anywhere]">
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
