"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  HELP_ARTICLES,
  CATEGORY_META,
  CATEGORY_ORDER,
  POPULAR_ARTICLE_SLUGS,
  resolveArticles,
  type HelpArticle,
  type HelpCategory,
} from "@/lib/help-articles";
import { requiresPlan } from "@/lib/gatedCapabilities";
import { buildHelpFuse } from "@/lib/help-search";
import { walkthroughConfigured } from "@/lib/walkthrough";
import { capture } from "@/lib/analytics";
import { HelpIcon } from "@/components/help/HelpIcon";
import { Card } from "@/components/bridge/layout/Card";

type Filter = HelpCategory | "All";

/** One-line description per category for the topic cards. Plain procurement copy. */
const CATEGORY_BLURB: Record<HelpCategory, string> = {
  "Getting started": "Get your first order parsed and on its way.",
  Connections: "Versioned supplier connections — draft, test, publish, roll back.",
  Mapping: "Connect buyer fields to supplier formats.",
  // The ERP connectors gate at Enterprise; listing them next to the ungated channels with no
  // qualifier reads as "included". Tier derived from the mirrored gate table, never typed.
  Delivery: `HTTP webhook, SFTP/FTPS, email, and ERP connectors (Erply, Directo) on ${requiresPlan("erpConnectors")}.`,
  Integrations: "Email intake, API keys, outbound webhooks, and connectors.",
  AI: "How mapping suggestions work and what confidence means.",
  Billing: "Plans, quotas, and what happens at the limit.",
  Troubleshooting: "Resolve failed deliveries and validation errors.",
};

function articleCount(category: HelpCategory): number {
  return HELP_ARTICLES.filter((a) => a.category === category).length;
}

export default function HelpIndex() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Filter>("All");

  const fuse = useMemo(() => buildHelpFuse(), []);

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
    <div className="mx-auto px-5 pb-24 pt-10 sm:px-6 sm:pt-14" style={{ maxWidth: 980 }}>
      <Link
        href="/bridge"
        className="mb-5 inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-[13px] font-semibold"
        style={{
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
          textDecoration: "none",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <span aria-hidden>←</span>
        Back to dashboard
      </Link>

      {/* Centered hero */}
      <header className="flex flex-col items-center text-center" style={{ padding: "10px 0 6px" }}>
        {/* ProcuLink link-curve mark — buyer→supplier gradient, blue #1E66C9 → green #2E8E3A. */}
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          className="h-9 w-9 sm:h-10 sm:w-10"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="help-hero-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1E66C9" />
              <stop offset="100%" stopColor="#2E8E3A" />
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
          <circle cx="8" cy="30" r="2.5" fill="#2E8E3A" />
        </svg>

        <h1
          className="mt-3.5"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            color: "var(--ink)",
          }}
        >
          How can we help?
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: "var(--ink-muted)" }}>
          Search the docs, or browse by topic.
        </p>

        {/* Centered search — surface card with strong border, matching the design source. */}
        <div
          className="mt-4 flex w-full items-center gap-2.5"
          style={{
            maxWidth: 520,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "0 14px",
            height: 46,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <span className="pointer-events-none shrink-0" style={{ color: "var(--ink-faint)" }} aria-hidden="true">
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
            className="h-full w-full min-w-0 border-none bg-transparent text-[14.5px] outline-none"
            style={{ color: "var(--ink)" }}
          />
          <span
            className="hidden shrink-0 font-mono text-[11px] sm:inline"
            style={{ color: "var(--ink-faint)" }}
            aria-live="polite"
          >
            {searching ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {/* Guides entry point — the "do this now" layer above the reference articles. */}
        <p className="mt-3.5 text-[13px]" style={{ color: "var(--ink-muted)" }}>
          Setting something up for the first time?{" "}
          <Link
            href="/help/guides"
            className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
            style={{ color: "var(--brand-blue-deep)" }}
          >
            Follow a step-by-step guide →
          </Link>
        </p>

        {/* Walkthrough link — rendered only when the video is configured (offer⇔works). */}
        {walkthroughConfigured() && (
          <p className="mt-3 text-[13px]" style={{ color: "var(--ink-muted)" }}>
            Prefer watching?{" "}
            <Link
              href="/watch"
              onClick={() => capture("help_watch_click", { surface: "help_center" })}
              className="font-semibold hover:underline"
              style={{ color: "var(--brand-blue-deep)" }}
            >
              Watch the walkthrough →
            </Link>
          </p>
        )}
      </header>

      {/* Search / filter results — shown only when actively searching or filtering */}
      {searching ? (
        <section className="mt-7">
          <div className="mb-2.5 flex items-center justify-between">
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ color: "var(--ink-faint)", letterSpacing: "0.06em" }}
            >
              {active !== "All" ? active : "Search results"}
            </span>
            <button
              type="button"
              onClick={reset}
              className="text-[12.5px] font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
              style={{ color: "var(--brand-blue-deep)" }}
            >
              Clear
            </button>
          </div>

          {results.length === 0 ? (
            <Card
              flush
              radius="var(--radius-md)"
              className="flex flex-col items-center gap-3 px-6 py-14 text-center"
            >
              <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>
                No matching articles
              </p>
              <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
                Nothing for {q ? <>&ldquo;{q}&rdquo;</> : "that topic"}. Try a different term or browse topics below.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-1 rounded-[6px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
                style={{ background: "var(--ink)" }}
              >
                Reset
              </button>
            </Card>
          ) : (
            <Card flush radius="var(--radius-md)" className="overflow-hidden">
              {results.map((article, i) => (
                <ArticleRow key={article.slug} article={article} first={i === 0} />
              ))}
            </Card>
          )}
        </section>
      ) : (
        <>
          {/* Topic cards — categories with no published article yet are hidden
              (offer⇔works: a card that filters to nothing is a dead control).
              They appear automatically as the content pass ships articles. */}
          <h2 className="sr-only">Browse help topics</h2>
          <div className="mt-8 grid gap-4 sm:mt-9 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_ORDER.filter((category) => articleCount(category) > 0).map((category) => (
              <TopicCard
                key={category}
                category={category}
                count={articleCount(category)}
                onSelect={() => setActive(category)}
              />
            ))}
          </div>

          {/* Popular articles */}
          <section className="mt-9 sm:mt-11">
            <span
              className="block text-[11px] font-semibold uppercase"
              style={{ color: "var(--ink-faint)", letterSpacing: "0.06em" }}
            >
              Popular articles
            </span>
            <Card flush radius="var(--radius-md)" className="mt-2.5 overflow-hidden">
              {resolveArticles(POPULAR_ARTICLE_SLUGS, POPULAR_ARTICLE_SLUGS.length).map((article, i) => (
                <ArticleRow key={article.slug} article={article} first={i === 0} />
              ))}
            </Card>
          </section>
        </>
      )}

      {/* Quiet support escape hatch — keeps the page ending clean, matching the design. */}
      <p className="mt-9 text-center text-[13.5px]" style={{ color: "var(--ink-muted)" }}>
        Can&rsquo;t find what you&rsquo;re looking for?{" "}
        <Link
          href="/support"
          className="font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
          style={{ color: "var(--brand-blue-deep)" }}
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
      className="group flex h-full flex-col p-4 text-left transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2 motion-reduce:transform-none"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-card)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      {/* Uniform blue chip across all categories — matches the design source. */}
      <span
        className="flex items-center justify-center"
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius)",
          background: "var(--brand-blue-soft)",
          color: "var(--brand-blue-deep)",
          marginBottom: 11,
        }}
        aria-hidden="true"
      >
        <HelpIcon name={meta.icon} size={17} />
      </span>

      <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
        {category}
      </h3>

      <p className="mt-[3px] text-[12px]" style={{ color: "var(--ink-muted)", lineHeight: 1.5 }}>
        {CATEGORY_BLURB[category]}
      </p>

      <span className="mt-2 text-[11px]" style={{ color: "var(--ink-faint)" }}>
        {count} {count === 1 ? "article" : "articles"}
      </span>
    </button>
  );
}

/** A single article row in the popular / search-results list. */
function ArticleRow({ article, first }: { article: HelpArticle; first: boolean }) {
  const min = article.readMin;
  return (
    <Link
      href={`/help/${article.slug}`}
      className="group flex items-center justify-between gap-3 px-[18px] py-[13px] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)]"
      style={first ? undefined : { borderTop: "1px solid var(--border)" }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center justify-center" style={{ color: "var(--ink-faint)" }} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </span>

        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>
            {article.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
            <span>
              {article.category}
              {min ? <> · {min} min</> : null}
            </span>
            {article.videoUrl && (
              <span
                className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold"
                style={{ color: "var(--brand-blue-deep)", background: "var(--brand-blue-soft)" }}
              >
                <span aria-hidden="true">▶</span> Video
              </span>
            )}
          </span>
        </span>
      </span>

      <span
        className="shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
        style={{ color: "var(--ink-faint)" }}
        aria-hidden="true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
