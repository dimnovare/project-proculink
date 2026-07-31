"use client";

// Article chrome for every /help/* MDX page. Wired in as the MDX `wrapper`
// (see src/mdx-components.tsx) so it wraps each article automatically — no
// per-file boilerplate. Provides: breadcrumb, category eyebrow, the ~720px
// prose column, a "Was this helpful?" prompt, a contact-support card, and a
// previous/next pager derived from the article order.
//
// FOCUS RINGS: `ring-brand-green-deep` (#1E6D29), which is 6.4128:1 on white
// and 5.9863:1 on --bg, against WCAG 1.4.11's 3:1 non-text floor. This shell
// used to ring in the RETIRED emerald (2.2731:1 on white, 2.1219:1 on --bg) —
// a colour the design system explicitly bans — on all 46 help articles. The
// hex gate never saw it: that gate is scoped to src/app/**, and this file is
// not. `src/test/token-contrast.test.ts` now bans the value repo-wide.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CATEGORY_META,
  getAdjacentArticles,
  getArticleBySlug,
  type HelpArticle,
} from "@/lib/help-articles";
import { getGuideByPath } from "@/lib/guides";
import GuideLayout from "./guide/GuideLayout";
import { HelpIcon } from "./HelpIcon";
import { capture } from "@/lib/analytics";

export default function HelpArticleShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // This component is the MDX `wrapper` for every .mdx page in the app, so it
  // is also where a route decides which chrome it gets. A registered guide
  // route (client under /help/guides, admin under /admin/guides) renders the
  // step-by-step layout instead of article chrome — that is what keeps guides
  // authorable as plain .mdx with no per-file layout boilerplate.
  const guide = getGuideByPath(pathname);
  if (guide) return <GuideLayout guide={guide}>{children}</GuideLayout>;

  // Any other MDX outside /help/ is not a help article; give it no chrome
  // rather than a breadcrumb into a help center it does not belong to.
  if (pathname && !pathname.startsWith("/help/")) return <>{children}</>;

  const slug = pathname?.split("/").filter(Boolean).pop() ?? "";
  const article = getArticleBySlug(slug);
  const { prev, next } = getAdjacentArticles(slug);
  const meta = article ? CATEGORY_META[article.category] : null;

  return (
    <div
      className="mx-auto px-5 pb-24 pt-9 sm:px-6 sm:pt-14"
      style={{ maxWidth: 760 }}
    >
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: "var(--ink-faint)" }}
      >
        <Link
          href="/help"
          className="rounded-[4px] font-medium transition-colors hover:text-[#0F4FA8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep focus-visible:ring-offset-2"
          style={{ color: "#56627A" }}
        >
          Help center
        </Link>
        {article && (
          <>
            <span aria-hidden="true" style={{ color: "#C6CDDA" }}>
              /
            </span>
            <span style={{ color: "var(--ink-faint)" }}>{article.category}</span>
          </>
        )}
      </nav>

      {/* Category eyebrow — sits directly above the MDX <h1> */}
      {article && meta && (
        <div
          className="mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold uppercase"
          style={{
            color: meta.color,
            background: meta.soft,
            letterSpacing: "0.04em",
          }}
        >
          <HelpIcon name={meta.icon} size={14} />
          {article.category}
        </div>
      )}

      {/* Per-tool walkthrough video — renders only when the registry entry
          carries a hosted, verified videoUrl (offer⇔works). No autoplay. */}
      {article?.videoUrl && (
        <video
          controls
          preload="metadata"
          poster={article.videoPosterUrl}
          src={article.videoUrl}
          className="mt-5 w-full rounded-[10px] border"
          style={{ borderColor: "#E2E6EE", background: "#0B1A2F", maxWidth: 720 }}
        />
      )}

      {/* Prose column — typography supplied by src/mdx-components.tsx */}
      <article className="mt-3" style={{ maxWidth: 720 }}>
        {children}
      </article>

      {/* Footer chrome */}
      <footer className="mt-12" style={{ maxWidth: 720 }}>
        <FeedbackPrompt slug={slug} title={article?.title} />

        <ContactCard />

        {(prev || next) && (
          <nav
            aria-label="More articles"
            className="mt-6 grid gap-3 sm:grid-cols-2"
          >
            {prev ? <Pager dir="prev" article={prev} /> : <span />}
            {next ? <Pager dir="next" article={next} /> : <span />}
          </nav>
        )}
      </footer>
    </div>
  );
}

/**
 * Thumb up / down, drawn in the same 16-viewBox, 1.4px-stroke construction the
 * rest of the system's glyphs use. `direction="down"` is the same path flipped,
 * so the two read as one pair rather than two drawings.
 */
function ThumbGlyph({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6, transform: direction === "down" ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M5 14V7.2l3-5.2c.9 0 1.5.7 1.4 1.6L9.1 6h3.3c.8 0 1.4.8 1.2 1.6l-1 4.9c-.1.9-.9 1.5-1.7 1.5H5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5 7.4H3.2c-.4 0-.7.3-.7.7v5.2c0 .4.3.7.7.7H5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function FeedbackPrompt({ slug, title }: { slug: string; title?: string }) {
  const [answer, setAnswer] = useState<null | "yes" | "no">(null);

  function vote(value: "yes" | "no") {
    setAnswer(value);
    capture("help_article_feedback", { slug, title, helpful: value === "yes" });
  }

  return (
    <div
      className="flex flex-col items-start gap-3 rounded-[10px] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}
    >
      <span className="text-[14px] font-medium" style={{ color: "#0B1A2F" }}>
        Was this article helpful?
      </span>

      {answer === null ? (
        <div className="flex items-center gap-2" role="group" aria-label="Was this article helpful?">
          <button
            type="button"
            onClick={() => vote("yes")}
            className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-[#F6F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep focus-visible:ring-offset-2"
            style={{ border: "1px solid #E2E6EE", color: "#0B1A2F", background: "#FFFFFF" }}
          >
            {/* SVG thumbs, not emoji: an emoji renders in the platform's font
                and skin-tone default, at a size the button cannot control, and
                CLAUDE.md §12 bans emoji as icons (WP-28). */}
            <ThumbGlyph direction="up" />
            Yes
          </button>
          <button
            type="button"
            onClick={() => vote("no")}
            className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-[#F6F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep focus-visible:ring-offset-2"
            style={{ border: "1px solid #E2E6EE", color: "#0B1A2F", background: "#FFFFFF" }}
          >
            <ThumbGlyph direction="down" />
            No
          </button>
        </div>
      ) : (
        <span className="text-[13px]" style={{ color: "#1E6D29" }} role="status">
          {answer === "yes"
            ? "Thanks for the feedback."
            : "Thanks — we'll work on making this clearer."}
        </span>
      )}
    </div>
  );
}

function ContactCard() {
  return (
    <div
      className="mt-4 flex flex-col items-start gap-3 overflow-hidden rounded-[10px] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ border: "1px solid #E2E6EE", background: "#F6F7FA" }}
    >
      <div>
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>
          Still need help?
        </p>
        <p className="mt-0.5 text-[13px]" style={{ color: "#56627A" }}>
          Our team replies to every message — usually within a business day.
        </p>
      </div>
      <Link
        href="/support"
        className="inline-flex shrink-0 items-center rounded-[7px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep focus-visible:ring-offset-2"
        style={{ background: "#0B1A2F" }}
      >
        Contact support →
      </Link>
    </div>
  );
}

function Pager({ dir, article }: { dir: "prev" | "next"; article: HelpArticle }) {
  const meta = CATEGORY_META[article.category];
  const isNext = dir === "next";
  return (
    <Link
      href={`/help/${article.slug}`}
      className="group flex flex-col gap-1 rounded-[10px] px-4 py-3 transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-deep focus-visible:ring-offset-2 motion-reduce:transform-none"
      style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}
    >
      <span
        className="flex items-center gap-1 text-[11.5px] font-semibold uppercase"
        style={{ color: "var(--ink-faint)", letterSpacing: "0.04em", justifyContent: isNext ? "flex-end" : "flex-start" }}
      >
        {!isNext && <span aria-hidden="true">←</span>}
        {isNext ? "Next" : "Previous"}
        {isNext && <span aria-hidden="true">→</span>}
      </span>
      <span
        className="flex items-center gap-2 text-[14px] font-semibold transition-colors group-hover:text-[#0F4FA8]"
        style={{ color: "#0B1A2F", justifyContent: isNext ? "flex-end" : "flex-start", textAlign: isNext ? "right" : "left" }}
      >
        <span style={{ color: meta.color, display: "inline-flex" }}>
          <HelpIcon name={meta.icon} size={15} />
        </span>
        {article.title}
      </span>
    </Link>
  );
}
