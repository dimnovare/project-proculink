"use client";

// Article chrome for every /help/* MDX page. Wired in as the MDX `wrapper`
// (see src/mdx-components.tsx) so it wraps each article automatically — no
// per-file boilerplate. Provides: breadcrumb, category eyebrow, the ~720px
// prose column, a "Was this helpful?" prompt, a contact-support card, and a
// previous/next pager derived from the article order.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CATEGORY_META,
  getAdjacentArticles,
  getArticleBySlug,
  type HelpArticle,
} from "@/lib/help-articles";
import { HelpIcon } from "./HelpIcon";
import { capture } from "@/lib/analytics";

export default function HelpArticleShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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
          className="rounded-[4px] font-medium transition-colors hover:text-[#0F4FA8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2"
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
            className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-[#F6F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2"
            style={{ border: "1px solid #E2E6EE", color: "#0B1A2F", background: "#FFFFFF" }}
          >
            👍 Yes
          </button>
          <button
            type="button"
            onClick={() => vote("no")}
            className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-[#F6F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2"
            style={{ border: "1px solid #E2E6EE", color: "#0B1A2F", background: "#FFFFFF" }}
          >
            👎 No
          </button>
        </div>
      ) : (
        <span className="text-[13px]" style={{ color: "#2E8E3A" }} role="status">
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
        className="inline-flex shrink-0 items-center rounded-[7px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2"
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
      className="group flex flex-col gap-1 rounded-[10px] px-4 py-3 transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2 motion-reduce:transform-none"
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
