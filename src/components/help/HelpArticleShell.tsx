"use client";

// Article chrome for every /help/* MDX page. Wired in as the MDX `wrapper`
// (see src/mdx-components.tsx) so it wraps each article automatically — no
// per-file boilerplate. Provides: breadcrumb, the title and its reading time,
// the prose column, an aside with the article's own headings and the guides
// that use it, a "Was this article helpful?" prompt, the previous/next
// articles, and where to ask a person.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdjacentArticles, getArticleBySlug } from "@/lib/help-articles";
import { getGuideByPath, guidesForArticle } from "@/lib/guides";
import GuideLayout from "./guide/GuideLayout";
import { capture } from "@/lib/analytics";
import { Card } from "@/components/bridge/layout/Card";
import { SITE } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { JsonLd } from "@/components/marketing/JsonLd";
import { breadcrumbStructuredData } from "@/lib/seo";

const ASIDE_LINK = "flex min-h-[40px] items-center py-1.5 text-[15px] leading-[1.35] text-ink-muted no-underline hover:text-ink";
const BUTTON = "inline-flex min-h-[44px] items-center rounded-[10px] border border-border-strong px-5 font-semibold text-ink hover:border-ink";

export default function HelpArticleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const slug = pathname?.split("/").filter(Boolean).pop() ?? "";
  const articleRef = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<{ id: string; text: string }[]>([]);

  // "In this article" is the body's own h2s, read once they are rendered (the MDX wrapper gets the body as one element).
  useEffect(() => {
    const found = articleRef.current?.querySelectorAll<HTMLHeadingElement>("h2[id]") ?? [];
    setToc([...found].map((h) => ({ id: h.id, text: h.textContent ?? "" })));
  }, [slug]);

  // This component is the MDX `wrapper` for every .mdx page in the app, so it
  // is also where a route decides which chrome it gets. A registered guide
  // route (client under /help/guides, admin under /admin/guides) renders the
  // step-by-step layout instead of article chrome.
  const guide = getGuideByPath(pathname);
  if (guide) return <GuideLayout guide={guide}>{children}</GuideLayout>;

  // Any other MDX outside /help/ is not a help article; give it no chrome.
  if (pathname && !pathname.startsWith("/help/")) return <>{children}</>;

  const article = getArticleBySlug(slug);
  const { prev, next } = getAdjacentArticles(slug);
  const guides = guidesForArticle(slug);

  return (
    <div className={SITE_PAGE}>
      <div className={`${SITE.wrap} pb-24 pt-10 sm:pt-14`}>
        <nav aria-label="Breadcrumb" className="text-[15px] text-ink-muted">
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0">
            <li>
              <Link href="/help" className="inline-flex min-h-[44px] items-center text-brand-blue-deep underline underline-offset-4">
                Help centre
              </Link>
            </li>
            {article && (
              <>
                <li aria-hidden="true">/</li>
                <li>{article.category}</li>
                {/* On a phone the title is the h1 just below, so the crumb stops at the category. */}
                <li aria-hidden="true" className="max-sm:hidden">/</li>
                <li aria-current="page" className="text-ink max-sm:hidden">
                  {article.title}
                </li>
              </>
            )}
          </ol>
        </nav>

        {article && (
          <JsonLd data={breadcrumbStructuredData([{ name: "Help centre", path: "/help" }, { name: article.title, path: `/help/${article.slug}` }])} />
        )}

        {article && (
          <header className="mt-4 flex flex-col gap-2">
            <h1 className={SITE.docH1}>
              {article.title}
            </h1>
            <p className={`${SITE.soft} m-0 text-[15px]`}>{article.readMin} minute read</p>
          </header>
        )}

        {/* Below 960px the aside is hidden, so the headings fold into a card under the title. */}
        {toc.length >= 2 && (
          <Card edge="none" pad="0 16px" data-testid="article-toc-folded" className="mt-6 min-[960px]:hidden">
            <details>
              <summary className="flex min-h-[48px] cursor-pointer items-center text-[15px] font-semibold">
                In this article · {toc.length} sections
              </summary>
              <nav aria-label="In this article" className="pb-2">
                <Toc toc={toc} />
              </nav>
            </details>
          </Card>
        )}

        <div className="mt-8 flex items-start gap-x-16">
          <div className="min-w-0 max-w-[72ch] flex-1">
            {/* Per-tool walkthrough video — only when the registry entry carries a hosted, verified videoUrl. No autoplay. */}
            {article?.videoUrl && (
              <video controls preload="metadata" poster={article.videoPosterUrl} src={article.videoUrl} className="mb-6 w-full rounded-[10px] border border-border bg-navy" />
            )}

            {/* The body's own `# Title` renders nothing (src/mdx-components.tsx): the h1 above is the page's only one. */}
            <article ref={articleRef}>{children}</article>

            <footer className="mt-12 flex flex-col gap-8">
              <FeedbackPrompt slug={slug} title={article?.title} />

              {/* Below 960px the aside is hidden, so its guides come here. */}
              <div data-testid="article-footer-guides" className="min-[960px]:hidden">
                <Guides id="article-guides-footer" guides={guides} />
              </div>

              {(prev || next) && (
                <nav aria-label="Keep reading" className="flex flex-col gap-3">
                  <h2 className="m-0 font-display text-[22px] font-semibold">Keep reading</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {prev ? <Pager label="Previous" slug={prev.slug} title={prev.title} /> : <span />}
                    {next ? <Pager label="Next" slug={next.slug} title={next.title} /> : <span />}
                  </div>
                </nav>
              )}

              <Card edge="none">
                <p className="m-0 font-semibold">Didn&apos;t find it?</p>
                <p className="m-0 mt-1">
                  Email{" "}
                  <a href="mailto:support@proculink.eu" className="text-brand-blue-deep underline underline-offset-4">
                    support@proculink.eu
                  </a>{" "}
                  and tell us what you were trying to do.
                </p>
                <Link href="/support" className={SITE.more}>
                  Contact support
                </Link>
              </Card>
            </footer>
          </div>

          <aside data-testid="article-aside" className="sticky top-6 hidden w-[260px] shrink-0 flex-col gap-8 min-[960px]:flex">
            {toc.length >= 2 && (
              <nav aria-label="In this article">
                <p className="m-0 text-[15px] font-semibold">In this article</p>
                <Toc toc={toc} />
              </nav>
            )}
            <Guides id="article-guides" guides={guides} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Toc({ toc }: { toc: { id: string; text: string }[] }) {
  return (
    <ol className="m-0 mt-2 list-none p-0">
      {toc.map((t) => (
        <li key={t.id}>
          <a href={`#${t.id}`} className={ASIDE_LINK}>
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

function Guides({ id, guides }: { id: string; guides: ReturnType<typeof guidesForArticle> }) {
  if (guides.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="m-0 text-[15px] font-semibold">
        Step-by-step guides
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
        {guides.map((g) => (
          <li key={g.slug} className="flex flex-col">
            <Link href={g.href} className="inline-flex min-h-[44px] items-center text-[15px] font-semibold text-brand-blue-deep underline underline-offset-4">
              {g.title}
            </Link>
            {g.minutes != null && <span className={`${SITE.soft} text-[14px]`}>About {g.minutes} minutes</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeedbackPrompt({ slug, title }: { slug: string; title?: string }) {
  const [answer, setAnswer] = useState<null | "yes" | "no">(null);

  function vote(value: "yes" | "no") {
    setAnswer(value);
    capture("help_article_feedback", { slug, title, helpful: value === "yes" });
  }

  return (
    <div className="flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-semibold">Was this article helpful?</span>
      {answer === null ? (
        <div className="flex items-center gap-2" role="group" aria-label="Was this article helpful?">
          <button type="button" onClick={() => vote("yes")} className={BUTTON}>
            Yes
          </button>
          <button type="button" onClick={() => vote("no")} className={BUTTON}>
            No
          </button>
        </div>
      ) : (
        <span className="text-brand-green-deep" role="status">
          {answer === "yes" ? "Thanks for the feedback." : "Thanks — we'll work on making this clearer."}
        </span>
      )}
    </div>
  );
}

function Pager({ label, slug, title }: { label: "Previous" | "Next"; slug: string; title: string }) {
  return (
    <Link
      href={`/help/${slug}`}
      className={`flex flex-col gap-1 rounded-[10px] border border-border bg-surface px-4 py-3 no-underline hover:border-border-strong ${label === "Next" ? "sm:items-end sm:text-right" : ""}`}
    >
      <span className={`${SITE.soft} text-[14px]`}>{label}</span>
      <span className="font-semibold text-brand-blue-deep underline underline-offset-4">{title}</span>
    </Link>
  );
}
