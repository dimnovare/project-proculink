"use client";

// Chrome for every step-by-step guide, client or admin.
//
// Wired in through the MDX wrapper (src/mdx-components.tsx, then HelpArticleShell),
// which hands a guide route to this layout instead of the article layout. A
// guide is therefore a plain `page.mdx` with zero layout boilerplate: write
// <Step>s, get a header, a "Steps" list beside them, and a footer.
//
// The step list is derived from the rendered DOM (`[data-guide-step]`) rather
// than from a registry, so a step's title can never disagree with its list
// entry. It hydrates in after mount; the prose itself is server-rendered and
// complete without JavaScript. No scroll-spy and no progress bar: the steps are
// the page.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { capture } from "@/lib/analytics";
import { resolveArticles } from "@/lib/help-articles";
import { START_HERE, getGuideBySlug, type Guide } from "@/lib/guides";
import { Card } from "@/components/bridge/layout/Card";
import { SITE } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { JsonLd } from "@/components/marketing/JsonLd";
import { breadcrumbStructuredData } from "@/lib/seo";
import { GuideProvider } from "./GuideContext";

interface StepMeta {
  id: string;
  title: string;
}

const stepsLine = (minutes: number | undefined, n: number) =>
  minutes != null ? `About ${minutes} minutes, ${n} ${n === 1 ? "step" : "steps"}` : `${n} ${n === 1 ? "step" : "steps"}`;

const H2 = "m-0 font-display text-[22px] font-semibold";
const BLUE_LINK = "font-semibold text-brand-blue-deep underline underline-offset-4";
const BUTTON = "inline-flex min-h-[44px] items-center rounded-[10px] border border-border-strong px-5 font-semibold text-ink hover:border-ink";

export default function GuideLayout({
  guide,
  children,
}: {
  guide: Guide;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const isAdmin = guide.audience === "admin";

  useEffect(() => {
    if (guide.audience === "client") {
      capture("guide_opened", { slug: guide.slug, section: guide.section });
    }
  }, [guide.slug, guide.section, guide.audience]);

  // Collect the steps the MDX actually rendered.
  useEffect(() => {
    const nodes = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-guide-step]") ?? []);
    setSteps(nodes.map((el) => ({ id: el.id, title: el.dataset.stepTitle ?? "" })));
  }, [children]);

  const related = resolveArticles(guide.related, 4);
  const startAt = START_HERE.indexOf(guide.slug);
  const nextGuide = startAt >= 0 && startAt < START_HERE.length - 1 ? getGuideBySlug(START_HERE[startAt + 1]) : undefined;

  return (
    <GuideProvider value={guide}>
      {/* Admin guides render inside PageShell, which already owns the page
          gutter — adding our own would double it on small screens. Client
          guides render on the marketing surface, which has no shell. */}
      <div className={isAdmin ? "" : SITE_PAGE}>
        <div className={isAdmin ? "pb-14 pt-1" : `${SITE.wrap} pb-24 pt-10 sm:pt-14`}>
          <GuideHeader guide={guide} stepCount={steps.length} />

          <div className="mt-8 flex items-start gap-x-16">
            <div className="min-w-0 max-w-[72ch] flex-1">
              <div ref={contentRef} className="guide-prose">
                {children}
              </div>

              <footer className="mt-14 flex flex-col gap-8">
                {isAdmin ? (
                  <AdminFooter />
                ) : (
                  <>
                    {nextGuide && (
                      <Card edge="none">
                        <p className={`${SITE.soft} m-0 text-[15px]`}>
                          Next guide, {startAt + 2} of {START_HERE.length}
                        </p>
                        <Link href={nextGuide.href} className={`${SITE.h3} ${BLUE_LINK} mt-1 inline-block`}>
                          {nextGuide.title}
                        </Link>
                        <p className="m-0 mt-2">{nextGuide.blurb}</p>
                        {nextGuide.minutes != null && (
                          <p className={`${SITE.soft} m-0 mt-1 text-[15px]`}>About {nextGuide.minutes} minutes.</p>
                        )}
                      </Card>
                    )}
                    <Link href="/help/guides" className={SITE.more}>
                      All step-by-step guides
                    </Link>
                    {related.length > 0 && (
                      <section aria-labelledby="guide-reference" className="flex flex-col gap-2">
                        <h2 id="guide-reference" className={H2}>
                          Reference articles
                        </h2>
                        <p className={`${SITE.soft} m-0`}>For more detail, read:</p>
                        <ul className="m-0 list-none p-0">
                          {related.map((a) => (
                            <li key={a.slug} className="border-t border-border first:border-t-0">
                              <Link href={`/help/${a.slug}`} className={`${BLUE_LINK} flex min-h-[44px] items-center py-2`}>
                                {a.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    <GuideFeedback slug={guide.slug} />
                    <Card edge="none">
                      <p className="m-0 font-semibold">Stuck on a step?</p>
                      <p className="m-0 mt-1">
                        Email{" "}
                        <a href="mailto:support@proculink.eu" className="text-brand-blue-deep underline underline-offset-4">
                          support@proculink.eu
                        </a>{" "}
                        and tell us which step and what you saw.
                      </p>
                      <Link href="/support" className={SITE.more}>
                        Contact support
                      </Link>
                    </Card>
                  </>
                )}
              </footer>
            </div>

            {steps.length > 0 && (
              <nav aria-label="Guide steps" className="sticky top-6 hidden w-[260px] shrink-0 min-[960px]:block">
                <p className="m-0 text-[15px] font-semibold">Steps</p>
                <ol className="m-0 mt-2 list-none p-0">
                  {steps.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="flex min-h-[40px] items-center py-1.5 text-[15px] leading-[1.35] text-ink-muted no-underline hover:text-ink"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>
        </div>
      </div>
    </GuideProvider>
  );
}

function GuideHeader({ guide, stepCount }: { guide: Guide; stepCount: number }) {
  const isAdmin = guide.audience === "admin";
  return (
    <header className="flex max-w-[72ch] flex-col gap-3">
      {/* Admin guides render inside the app shell, whose top bar has no
          breadcrumb row; the way back from a guide is its footer link. */}
      {isAdmin ? (
        <span className="inline-flex h-[26px] w-fit items-center rounded-full bg-amber-soft px-2.5 text-[13px] font-semibold text-amber-text">
          Internal · admins only
        </span>
      ) : (
        <nav aria-label="Breadcrumb" className="text-[15px] text-ink-muted">
          <JsonLd
            data={breadcrumbStructuredData([
              { name: "Help centre", path: "/help" },
              { name: "Step-by-step guides", path: "/help/guides" },
              { name: guide.title, path: guide.href },
            ])}
          />
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0">
            <li>
              <Link href="/help" className="inline-flex min-h-[44px] items-center text-brand-blue-deep underline underline-offset-4">
                Help centre
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/help/guides" className="inline-flex min-h-[44px] items-center text-brand-blue-deep underline underline-offset-4">
                Step-by-step guides
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-ink">
              {guide.title}
            </li>
          </ol>
        </nav>
      )}

      <h1 className="m-0 font-display text-[clamp(34px,4vw,48px)] font-semibold leading-[1.06] tracking-[-0.02em] [text-wrap:balance]">
        {guide.title}
      </h1>
      <p className={`${SITE.soft} m-0 text-[19px]`}>{guide.blurb}</p>
      {stepCount > 0 && <p className={`${SITE.soft} m-0 text-[15px]`}>{stepsLine(guide.minutes, stepCount)}</p>}
    </header>
  );
}

function GuideFeedback({ slug }: { slug: string }) {
  const [answer, setAnswer] = useState<null | "yes" | "no">(null);
  const vote = useCallback(
    (value: "yes" | "no") => {
      setAnswer(value);
      capture("guide_feedback", { slug, completed: value === "yes" });
    },
    [slug],
  );

  return (
    <div className="flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-semibold">Did this guide get you there?</span>
      {answer === null ? (
        <div className="flex items-center gap-2" role="group" aria-label="Did this guide get you there?">
          {(["yes", "no"] as const).map((v) => (
            <button key={v} type="button" onClick={() => vote(v)} className={BUTTON}>
              {v === "yes" ? "Yes" : "Not quite"}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-brand-green-deep" role="status">
          {answer === "yes"
            ? "Good — thanks for telling us."
            : "Thanks — tell support which step lost you and we'll fix the guide."}
        </span>
      )}
    </div>
  );
}

function AdminFooter() {
  return (
    <Card edge="none">
      <p className="m-0 text-[13.5px] font-semibold text-ink">Internal runbook</p>
      <p className="m-0 mt-1 text-[13px] leading-[1.6] text-ink-muted">
        This page is served only to email addresses on the admin allowlist. It is not in the
        sitemap, it is disallowed in robots.txt, and it is not linked from the public help
        center. Keep customer-specific values out of it — put those in the QA notes instead.
      </p>
      <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        <Link href="/admin/guides" className="text-brand-blue-deep hover:underline">
          All runbooks
        </Link>
        <Link href="/admin" className="text-brand-blue-deep hover:underline">
          Back to the admin dashboard
        </Link>
      </p>
    </Card>
  );
}
