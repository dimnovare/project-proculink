"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  HELP_ARTICLES,
  CATEGORY_ORDER,
  POPULAR_ARTICLE_SLUGS,
  resolveArticles,
  type HelpCategory,
} from "@/lib/help-articles";
import { START_HERE, getGuideBySlug, liveClientGuides } from "@/lib/guides";
import { articleHit, buildSiteHelpFuse, searchHelpArticles, type HelpHit } from "@/lib/help-search";
import { DOCUMENT_TABS } from "@/lib/documentTabs";
import { Card } from "@/components/bridge/layout/Card";
import { SITE, Tag } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";

/** One-line description per category for the topic rows. */
const CATEGORY_BLURB: Record<HelpCategory, string> = {
  "Getting started": "What ProcuLink does, and how it uses AI.",
  Documents: "What we read, what each status means, and what to do when a document stops.",
  Flows: "Values, versions, and what we learn from each sender.",
  "Sending in": "Upload, email, mailbox, SFTP, FTP, S3 and API.",
  "Files and destinations": "Choose a format, then send it by email, to a web address, to an SFTP or FTPS server, an S3 bucket, Google Drive or Google Sheets, or download it.",
  Lookups: "Translate one value into another with a list you import.",
  Account: "Your team, API keys, plan, history and old orders.",
  API: "Send files in and get results out, with signed webhooks.",
};

/** The Documents tabs a stuck document sits under, named as the app names them. */
const STUCK = [
  ["needs-you", "Check the marked values, then send it."],
  ["failed", "If it couldn't be read, try again or upload a clearer copy. If it couldn't be sent, fix the destination, then send it again."],
] as const;

const H2 = "m-0 font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]";
const LINK = "font-semibold text-brand-blue-deep underline underline-offset-4";
const ROW = "flex min-h-[44px] flex-col justify-center gap-0.5 border-t border-border py-3 no-underline first:border-t-0";

const articleCount = (category: HelpCategory) => HELP_ARTICLES.filter((a) => a.category === category).length;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const meta = (hit: HelpHit) =>
  hit.kind === "article"
    ? `${hit.minutes} minute read`
    : `Step-by-step guide${hit.minutes != null ? `, about ${hit.minutes} minutes` : ""}`;

function HitRows({ hits }: { hits: HelpHit[] }) {
  return (
    <Card edge="none">
      {hits.map((hit) => (
        <Link key={hit.href} href={hit.href} className={ROW}>
          <span className="font-semibold text-brand-blue-deep underline underline-offset-4">{hit.title}</span>
          <span className="text-[15px] text-ink-muted">{meta(hit)}</span>
        </Link>
      ))}
    </Card>
  );
}

export default function HelpIndex() {
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState<HelpCategory | null>(null);
  const fuse = useMemo(() => buildSiteHelpFuse(), []);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  // A chosen topic replaces the topic buttons, so focus moves to the results it opened, never to the page.
  useEffect(() => {
    if (topic) resultsRef.current?.focus();
  }, [topic]);

  const query = q.trim();
  const searching = query.length > 0 || topic !== null;
  const hits = query
    ? searchHelpArticles(fuse, query, 50)
    : HELP_ARTICLES.filter((a) => a.category === topic).map(articleHit);
  const clear = () => {
    setQ("");
    setTopic(null);
    searchRef.current?.focus();
  };

  return (
    <div className={SITE_PAGE}>
      <section className="pb-12 pt-12 sm:pt-16">
        <div className={`${SITE.wrap} grid items-start gap-10 min-[960px]:grid-cols-[minmax(0,1fr)_360px]`}>
          <div className="flex min-w-0 flex-col gap-4">
            <h1 className="m-0 font-display text-[clamp(38px,4.2vw,56px)] font-semibold leading-[1.04] tracking-[-0.02em]">
              How can we help?
            </h1>
            <p className={`${SITE.soft} m-0 text-[19px]`}>
              Search for what you are trying to do, follow a step-by-step guide, or{" "}
              <a href="#ask" className={LINK}>
                ask a person
              </a>
              .
            </p>
            <label className="mt-2 flex max-w-[560px] flex-col gap-2">
              <span className="font-semibold">Search articles and guides</span>
              <input
                ref={searchRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQ("")}
                className="h-[52px] w-full min-w-0 rounded-[10px] border border-border-strong bg-surface px-4 text-[17px] text-ink"
              />
            </label>
            {/* Always mounted, so the first count is announced too; the visible count is hidden from screen readers. */}
            <p aria-live="polite" className="sr-only">
              {searching ? plural(hits.length, "result") : ""}
            </p>
          </div>

          <Card edge="none" as="section" aria-labelledby="help-stuck">
            <h2 id="help-stuck" className="m-0 font-display text-[20px] font-semibold">
              Is a document stuck?
            </h2>
            <p className={`${SITE.soft} mb-3 mt-1 text-[15px]`}>Find it under Documents to see what to do.</p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {STUCK.map(([key, todo]) => (
                <li key={key} className="flex flex-col items-start gap-1">
                  <Tag tone={key === "failed" ? "bad" : "need"}>{DOCUMENT_TABS.find((t) => t.id === key)!.label}</Tag>
                  <span className="text-[15px]">{todo}</span>
                </li>
              ))}
            </ul>
            <Link href="/help/documents-and-statuses" className={`${SITE.more} text-[15px]`}>
              Documents and their statuses
            </Link>
          </Card>
        </div>
      </section>

      <div className="bg-surface pb-24 pt-12">
        <div className={`${SITE.wrap} flex flex-col gap-14`}>
          {searching ? (
            <section aria-labelledby="help-results" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="help-results" ref={resultsRef} tabIndex={-1} className={H2}>
                  {query ? "Search results" : topic}
                </h2>
                <span className="flex items-center gap-4">
                  <span aria-hidden="true" className={`${SITE.soft} text-[15px]`}>
                    {plural(hits.length, "result")}
                  </span>
                  <button type="button" onClick={clear} className={`${LINK} min-h-[44px]`}>
                    Clear
                  </button>
                </span>
              </div>
              {hits.length === 0 ? (
                <Card edge="none">
                  <p className="m-0 font-semibold">No matching articles or guides</p>
                  <p className={`${SITE.soft} m-0 mt-1`}>
                    Nothing for &ldquo;{query}&rdquo;. Try other words, or clear the search to browse by topic.
                  </p>
                </Card>
              ) : (
                <HitRows hits={hits} />
              )}
            </section>
          ) : (
            <>
              <section aria-labelledby="help-start" className="flex flex-col gap-3">
                <h2 id="help-start" className={H2}>
                  Start here
                </h2>
                <p className={`${SITE.soft} m-0`}>
                  New to ProcuLink? These three guides take one document from upload to a file that has been sent.
                </p>
                <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
                  {START_HERE.map((slug) => getGuideBySlug(slug)!).map((g) => (
                    <Card key={g.slug} edge="none" as="li">
                      <Link href={g.href} className={`${SITE.h3} inline-flex min-h-[44px] items-center text-brand-blue-deep underline underline-offset-4`}>
                        {g.title}
                      </Link>
                      <p className="m-0 mt-2 text-[15px]">{g.blurb}</p>
                      {g.minutes != null && <p className={`${SITE.soft} m-0 mt-2 text-[15px]`}>About {g.minutes} minutes</p>}
                    </Card>
                  ))}
                </ol>
                <Link href="/help/guides" className={SITE.more}>
                  All {liveClientGuides().length} step-by-step guides
                </Link>
              </section>

              <section aria-labelledby="help-topics" className="flex flex-col gap-4">
                <h2 id="help-topics" className={H2}>
                  Browse by topic
                </h2>
                {/* Only topics with an article: a topic that filters to nothing is a dead control. Each is a
                    <button> that filters this page in place; there is no topic page. */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {CATEGORY_ORDER.filter((c) => articleCount(c) > 0).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setTopic(c)}
                      className="flex flex-col items-start gap-1 rounded-[10px] border border-border bg-surface p-5 text-left hover:border-border-strong"
                    >
                      <h3 className="m-0 font-display text-[19px] font-semibold text-ink">{c}</h3>
                      <span className={`${SITE.soft} text-[15px]`}>{plural(articleCount(c), "article")}</span>
                      <span className="text-[15px] text-ink">{CATEGORY_BLURB[c]}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section aria-labelledby="help-popular" className="flex flex-col gap-3">
                <h2 id="help-popular" className={H2}>
                  Popular articles
                </h2>
                <HitRows hits={resolveArticles(POPULAR_ARTICLE_SLUGS, POPULAR_ARTICLE_SLUGS.length).map(articleHit)} />
              </section>
            </>
          )}

          <section id="ask" aria-labelledby="help-ask" className="flex scroll-mt-24 flex-col gap-2 border-t border-border pt-10">
            <h2 id="help-ask" className={H2}>
              Ask a person
            </h2>
            <p className="m-0">
              Email{" "}
              <a href="mailto:support@proculink.eu" className={LINK}>
                support@proculink.eu
              </a>{" "}
              and tell us what you were trying to do.
            </p>
            <p className="m-0 flex flex-wrap gap-x-7">
              <Link href="/support" className={SITE.more}>
                Contact support
              </Link>
              <Link href="/support#report-a-bug" className={SITE.more}>
                Report a problem
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
