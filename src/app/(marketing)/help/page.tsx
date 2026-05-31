"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Fuse from "fuse.js";
import {
  HELP_ARTICLES,
  CATEGORY_META,
  CATEGORY_ORDER,
  type HelpArticle,
  type HelpCategory,
} from "@/lib/help-articles";
import { HelpIcon } from "@/components/help/HelpIcon";

type Filter = HelpCategory | "All";

const BRAND_DEEP = "#1DAF50";

/** One-line description per category for the topic cards. Plain procurement copy. */
const CATEGORY_BLURB: Record<HelpCategory, string> = {
  "Getting started": "Upload your first purchase order and get it parsed.",
  Mapping: "Connect buyer fields to your supplier formats.",
  Delivery: "HTTP webhook, email, and ERP connectors.",
  AI: "How mapping suggestions work and what confidence means.",
  Billing: "Plans, quotas, and what happens at the limit.",
  Email: "Ingest orders that arrive as email attachments.",
  Troubleshooting: "Resolve failed deliveries and validation errors.",
};

/** Estimated read time per article slug — shown in the popular-articles list. */
const READ_MIN: Record<string, number> = {
  "first-upload": 4,
  "mapping-basics": 6,
  "delivery-config": 5,
  "ai-suggestions": 5,
  "billing-faq": 4,
  "email-polling": 5,
  troubleshooting: 3,
};

function articleCount(category: HelpCategory): number {
  return HELP_ARTICLES.filter((a) => a.category === category).length;
}

export default function HelpIndex() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Filter>("All");

  const fuse = useMemo(
    () => new Fuse(HELP_ARTICLES, { keys: ["title", "blurb", "category"], threshold: 0.4 }),
    [],
  );

  const searching = q.trim().length > 0 || active !== "All";

  const results = useMemo(() => {
    let list: HelpArticle[] = q.trim() ? fuse.search(q).map((r) => r.item) : HELP_ARTICLES;
    if (active !== "All") list = list.filter((a) => a.category === active);
    return list;
  }, [q, active, fuse]);

  function reset() {
    setQ("");
    setActive("All");
  }

  return (
    <div className="mx-auto px-5 pb-24 pt-12 sm:px-6 sm:pt-16" style={{ maxWidth: 980 }}>
      {/* Centered hero */}
      <header className="flex flex-col items-center text-center">
        {/* ProcuLink link-curve mark — buyer→supplier gradient, sampled blue #1E66C9 → green #28C55E. */}
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          className="h-[34px] w-[34px] sm:h-[38px] sm:w-[38px]"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="help-hero-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1E66C9" />
              <stop offset="100%" stopColor="#28C55E" />
            </linearGradient>
          </defs>
          <path
            d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
            stroke="url(#help-hero-mark)"
            strokeWidth="3.6"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="8" cy="10" r="2.5" fill="#1E66C9" />
          <circle cx="8" cy="30" r="2.5" fill="#28C55E" />
        </svg>

        <h1
          className="mt-5"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(32px, 5vw, 46px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            color: "#0B1A2F",
          }}
        >
          How can we help?
        </h1>
        <p className="mt-3 text-[15px] sm:text-[16px]" style={{ color: "#56627A", lineHeight: 1.6 }}>
          Search the docs, or browse by topic.
        </p>

        {/* Centered search */}
        <div className="relative mt-7 w-full sm:mt-8" style={{ maxWidth: 640 }}>
          <span
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
            style={{ color: "#8A93A5" }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search for articles, e.g. 'SFTP delivery'…"
            aria-label="Search help articles"
            className="w-full rounded-[10px] border border-[#E2E6EE] bg-[#F6F7FA] pl-11 pr-11 text-[14.5px] transition-colors hover:border-[#C6CDDA] focus:border-[var(--brand-green)] focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-[rgba(40,197,94,0.18)]"
            style={{ height: 52, color: "#0B1A2F" }}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[16px] transition-colors hover:bg-[#F0F2F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-green)]"
              style={{ color: "#8A93A5", lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
      </header>

      {/* Search / filter results — shown only when actively searching or filtering */}
      {searching ? (
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold uppercase" style={{ color: "#8A93A5", letterSpacing: "0.07em" }}>
              {active !== "All" ? active : "Search results"}
            </h2>
            <button
              type="button"
              onClick={reset}
              className="text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-green)] focus-visible:ring-offset-2"
              style={{ color: BRAND_DEEP }}
            >
              Clear
            </button>
          </div>

          {results.length === 0 ? (
            <div
              className="mt-5 flex flex-col items-center gap-3 rounded-[12px] px-6 py-14 text-center"
              style={{ border: "1px dashed #C6CDDA", background: "#FFFFFF" }}
            >
              <p className="text-[14px] font-medium" style={{ color: "#0B1A2F" }}>
                No articles match {q ? <>&ldquo;{q}&rdquo;</> : "that topic"}.
              </p>
              <p className="text-[13px]" style={{ color: "#8A93A5" }}>
                Try a different search, or browse every guide.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-1 rounded-[8px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-green)] focus-visible:ring-offset-2"
                style={{ background: "#0B1A2F" }}
              >
                Reset
              </button>
            </div>
          ) : (
            <div
              className="mt-5 overflow-hidden rounded-[12px] border border-[#E2E6EE] bg-white"
              style={{ boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
            >
              {results.map((article, i) => (
                <ArticleRow key={article.slug} article={article} first={i === 0} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {/* Topic cards */}
          <h2 className="sr-only">Browse help topics</h2>
          <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_ORDER.map((category) => (
              <TopicCard
                key={category}
                category={category}
                count={articleCount(category)}
                onSelect={() => setActive(category)}
              />
            ))}
          </div>

          {/* Popular articles */}
          <section className="mt-12 sm:mt-14">
            <h2 className="text-[12px] font-semibold uppercase" style={{ color: "#8A93A5", letterSpacing: "0.07em" }}>
              Popular articles
            </h2>
            <div
              className="mt-4 overflow-hidden rounded-[12px] border border-[#E2E6EE] bg-white"
              style={{ boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
            >
              {HELP_ARTICLES.map((article, i) => (
                <ArticleRow key={article.slug} article={article} first={i === 0} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* Quiet support escape hatch — keeps the page ending clean, matching the design. */}
      <p className="mt-10 text-center text-[13.5px]" style={{ color: "#56627A" }}>
        Can&rsquo;t find what you&rsquo;re looking for?{" "}
        <Link
          href="/support"
          className="font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-green)] focus-visible:ring-offset-2"
          style={{ color: "var(--brand-green-deep)" }}
        >
          Contact support →
        </Link>
      </p>
    </div>
  );
}

/** A browse-by-topic card. Clicking filters the index to that category. */
function TopicCard({
  category,
  count,
  onSelect,
}: {
  category: HelpCategory;
  count: number;
  onSelect: () => void;
}) {
  const meta = CATEGORY_META[category];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex h-full flex-col rounded-[12px] border border-[#E2E6EE] bg-white p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#C6CDDA] hover:shadow-[0_8px_24px_rgba(11,26,47,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-green)] focus-visible:ring-offset-2 motion-reduce:transform-none"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-[10px]"
        style={{ background: "#E3EDFB", color: "#1E66C9" }}
        aria-hidden="true"
      >
        <HelpIcon name={meta.icon} size={20} />
      </span>

      <h3
        className="mt-4 text-[16px] font-semibold transition-colors"
        style={{ color: "#0B1A2F", letterSpacing: "-0.01em" }}
      >
        {category}
      </h3>

      <p className="mt-1.5 text-[13px]" style={{ color: "#56627A", lineHeight: 1.5 }}>
        {CATEGORY_BLURB[category]}
      </p>

      <span className="mt-4 text-[12.5px] font-medium" style={{ color: "#8A93A5" }}>
        {count} {count === 1 ? "article" : "articles"}
      </span>
    </button>
  );
}

/** A single article row in the popular / search-results list. */
function ArticleRow({ article, first }: { article: HelpArticle; first: boolean }) {
  const min = READ_MIN[article.slug];
  return (
    <Link
      href={`/help/${article.slug}`}
      className="group flex items-center gap-3.5 px-4 py-4 transition-colors hover:bg-[#F6F7FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-green)] sm:px-5"
      style={first ? undefined : { borderTop: "1px solid #EDEFF4" }}
    >
      <span className="flex shrink-0 items-center justify-center" style={{ color: "#8C95A6" }} aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold" style={{ color: "#0B1A2F" }}>
          {article.title}
        </span>
        <span className="mt-0.5 block text-[12.5px]" style={{ color: "#8A93A5" }}>
          {article.category}
          {min ? <> · {min} min</> : null}
        </span>
      </span>

      <span
        className="shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
        style={{ color: "#B6BECC" }}
        aria-hidden="true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
