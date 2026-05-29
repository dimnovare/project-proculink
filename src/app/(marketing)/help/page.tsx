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

// "All" reuses the buyer-blue accent; every other chip pulls its colour from
// the locked per-category token map.
function chipColors(filter: Filter): { color: string; soft: string } {
  if (filter === "All") return { color: "#0F4FA8", soft: "#E3EDFB" };
  const { color, soft } = CATEGORY_META[filter];
  return { color, soft };
}

export default function HelpIndex() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Filter>("All");

  const fuse = useMemo(
    () => new Fuse(HELP_ARTICLES, { keys: ["title", "blurb", "category"], threshold: 0.4 }),
    [],
  );

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
    <div className="mx-auto px-5 pb-24 pt-12 sm:px-6 sm:pt-16" style={{ maxWidth: 940 }}>
      {/* Header */}
      <header>
        <h1
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: "clamp(30px, 4.5vw, 42px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            color: "#0B1A2F",
          }}
        >
          Help center
        </h1>
        <p className="mt-2 text-[15px] sm:text-[15.5px]" style={{ color: "#56627A", lineHeight: 1.6 }}>
          Short, focused guides for the most common ProcuLink tasks — uploading,
          mapping, delivery, and billing.
        </p>

        {/* Search */}
        <div className="relative mt-6 sm:mt-7" style={{ maxWidth: 520 }}>
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "#8A93A5" }}
            aria-hidden="true"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search articles…"
            aria-label="Search help articles"
            className="w-full rounded-[8px] border border-[#E2E6EE] bg-white pl-10 pr-10 text-[14px] transition-colors focus:border-[#1E66C9] focus:outline-none focus:ring-[3px] focus:ring-[rgba(30,102,201,0.18)]"
            style={{ height: 46, color: "#0B1A2F" }}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[16px] transition-colors hover:bg-[#F0F2F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9]"
              style={{ color: "#8A93A5", lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
      </header>

      {/* Category filter chips */}
      <div
        role="group"
        aria-label="Filter articles by category"
        className="mt-6 flex flex-wrap gap-2"
      >
        {(["All", ...CATEGORY_ORDER] as Filter[]).map((filter) => {
          const isActive = active === filter;
          const { color, soft } = chipColors(filter);
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(filter)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9] focus-visible:ring-offset-2 ${
                isActive
                  ? ""
                  : "border-[#E2E6EE] bg-white text-[#56627A] hover:bg-[#F6F7FA] hover:text-[#0B1A2F]"
              }`}
              style={isActive ? { background: soft, borderColor: `${color}55`, color } : undefined}
            >
              {filter}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <h2 className="sr-only">Articles</h2>
      {results.length === 0 ? (
        <div
          className="mt-8 flex flex-col items-center gap-3 rounded-[12px] px-6 py-14 text-center"
          style={{ border: "1px dashed #C6CDDA", background: "#FFFFFF" }}
        >
          <p className="text-[14px] font-medium" style={{ color: "#0B1A2F" }}>
            No articles match {q ? <>&ldquo;{q}&rdquo;</> : "that filter"}.
          </p>
          <p className="text-[13px]" style={{ color: "#8A93A5" }}>
            Try a different search, or browse every guide.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-1 rounded-[7px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9] focus-visible:ring-offset-2"
            style={{ background: "#0B1A2F" }}
          >
            Reset
          </button>
        </div>
      ) : (
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {results.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      )}

      {/* Contact band */}
      <div
        className="mt-10 flex flex-col items-start gap-3 rounded-[12px] px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ border: "1px solid #E2E6EE", background: "#F6F7FA" }}
      >
        <div>
          <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>
            Can&rsquo;t find what you&rsquo;re looking for?
          </p>
          <p className="mt-0.5 text-[13px]" style={{ color: "#56627A" }}>
            Reach our team directly — we reply to every message.
          </p>
        </div>
        <Link
          href="/support"
          className="inline-flex shrink-0 items-center rounded-[7px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9] focus-visible:ring-offset-2"
          style={{ background: "#0B1A2F" }}
        >
          Contact support →
        </Link>
      </div>
    </div>
  );
}

function ArticleCard({ article }: { article: HelpArticle }) {
  const meta = CATEGORY_META[article.category];
  return (
    <Link
      href={`/help/${article.slug}`}
      className="group flex flex-col rounded-[10px] border border-[#E2E6EE] bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#C6CDDA] hover:shadow-[0_8px_24px_rgba(11,26,47,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9] focus-visible:ring-offset-2 motion-reduce:transform-none"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-[9px]"
        style={{ background: meta.soft, color: meta.color }}
        aria-hidden="true"
      >
        <HelpIcon name={meta.icon} size={18} />
      </span>

      <span
        className="mt-3 text-[11px] font-semibold uppercase"
        style={{ color: meta.color, letterSpacing: "0.05em" }}
      >
        {article.category}
      </span>

      <h3
        className="mt-1 text-[15.5px] font-semibold transition-colors group-hover:text-[#0F4FA8]"
        style={{ color: "#0B1A2F", letterSpacing: "-0.01em" }}
      >
        {article.title}
      </h3>

      <p className="mt-1 line-clamp-2 text-[13px]" style={{ color: "#56627A", lineHeight: 1.5 }}>
        {article.blurb}
      </p>

      <span
        className="mt-3 flex items-center gap-1 text-[12.5px] font-semibold"
        style={{ color: "#1E66C9" }}
      >
        Read article
        <span className="transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true">
          →
        </span>
      </span>
    </Link>
  );
}
