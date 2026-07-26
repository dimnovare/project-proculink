"use client";

// Chrome for every step-by-step guide, client or admin.
//
// Wired in through the MDX wrapper (src/mdx-components.tsx → HelpArticleShell),
// which hands a guide route to this layout instead of the article layout. A
// guide is therefore a plain `page.mdx` with zero layout boilerplate: write
// <Step>s, get a header, a step-list sidebar, progress, and a footer.
//
// The step list is derived from the rendered DOM (`[data-guide-step]`) rather
// than from a registry, so a step's title can never disagree with its sidebar
// entry. It hydrates in after mount; the prose itself is server-rendered and
// complete without JavaScript.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { capture } from "@/lib/analytics";
import { resolveArticles } from "@/lib/help-articles";
import type { Guide } from "@/lib/guides";
import { GuideProvider } from "./GuideContext";

interface StepMeta {
  id: string;
  n: string;
  title: string;
}

/** Distance from the viewport top at which a step counts as "the current one". */
const ACTIVE_OFFSET = 140;

export default function GuideLayout({
  guide,
  children,
}: {
  guide: Guide;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState<StepMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  const isAdmin = guide.audience === "admin";

  useEffect(() => {
    if (guide.audience === "client") {
      capture("guide_opened", { slug: guide.slug, section: guide.section });
    }
  }, [guide.slug, guide.section, guide.audience]);

  // Collect the steps the MDX actually rendered, then track which one the
  // reader is on. A passive scroll listener with a rAF guard is enough here and
  // stays correct while the page height changes (lazy screenshots loading in).
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-guide-step]"));
    setSteps(
      nodes.map((el) => ({
        id: el.id,
        n: el.dataset.stepN ?? "",
        title: el.dataset.stepTitle ?? "",
      })),
    );
    if (nodes.length === 0) return;

    let frame = 0;
    const recompute = () => {
      frame = 0;
      let current = nodes[0].id;
      for (const el of nodes) {
        if (el.getBoundingClientRect().top <= ACTIVE_OFFSET) current = el.id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(recompute);
    };

    recompute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [children]);

  const activeIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === activeId),
  );
  const related = resolveArticles(guide.related, 4);

  return (
    <GuideProvider value={guide}>
      {/* Admin guides render inside PageShell, which already owns the page
          gutter — adding our own would double it on small screens. Client
          guides render on the marketing surface, which has no shell. */}
      <div
        className={`mx-auto ${isAdmin ? "pb-14 pt-1" : "px-5 pb-24 pt-8 sm:px-6 sm:pt-12"}`}
        style={{ maxWidth: 1024 }}
      >
        <GuideHeader guide={guide} minutes={guide.minutes} stepCount={steps.length} />

        {steps.length > 0 && (
          <MobileStepList steps={steps} activeIndex={activeIndex} className="lg:hidden" />
        )}

        <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_212px] lg:items-start lg:gap-10">
          <div ref={contentRef} className="guide-prose" style={{ maxWidth: 720 }}>
            {children}
          </div>

          {steps.length > 0 && (
            <aside className="hidden lg:block">
              <StepSidebar steps={steps} activeIndex={activeIndex} />
            </aside>
          )}
        </div>

        <footer className="mt-14" style={{ maxWidth: 720 }}>
          {isAdmin ? (
            <AdminFooter />
          ) : (
            <>
              <GuideFeedback slug={guide.slug} />
              {related.length > 0 && (
                <section className="mt-6">
                  <h2
                    className="text-[11px] font-semibold uppercase"
                    style={{ color: "var(--ink-faint)", letterSpacing: "0.06em" }}
                  >
                    Reference articles
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: "var(--ink-muted)" }}>
                    This guide is the procedure. These go deeper on the details.
                  </p>
                  <ul className="mt-2.5 list-none space-y-0 p-0">
                    {related.map((a) => (
                      <li key={a.slug} className="m-0">
                        <Link
                          href={`/help/${a.slug}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px] font-medium transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)]"
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-md)",
                            background: "var(--surface)",
                            color: "var(--ink)",
                            textDecoration: "none",
                            marginBottom: 8,
                          }}
                        >
                          {a.title}
                          <span aria-hidden="true" style={{ color: "var(--ink-faint)" }}>
                            →
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div
                className="mt-6 flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--surface-2)",
                }}
              >
                <div>
                  <p className="m-0 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                    Stuck part-way through?
                  </p>
                  <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-muted)" }}>
                    Tell us which step and what you saw — we reply to every message.
                  </p>
                </div>
                <Link
                  href="/support"
                  className="inline-flex shrink-0 items-center rounded-[7px] px-4 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
                  style={{ background: "var(--ink)", textDecoration: "none" }}
                >
                  Contact support →
                </Link>
              </div>
            </>
          )}
        </footer>
      </div>
    </GuideProvider>
  );
}

function GuideHeader({
  guide,
  minutes,
  stepCount,
}: {
  guide: Guide;
  minutes?: number;
  stepCount: number;
}) {
  const isAdmin = guide.audience === "admin";
  return (
    <header style={{ maxWidth: 720 }}>
      {/* Admin guides render inside the app shell, whose topbar already provides
          a breadcrumb for the route. A second one would duplicate the landmark
          and the navigation; the runbook index is reachable from the footer. */}
      {!isAdmin && (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1.5 text-[12.5px]"
          style={{ color: "var(--ink-faint)" }}
        >
          <Link
            href="/help"
            className="rounded-[4px] font-medium transition-colors hover:text-[var(--brand-blue-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
            style={{ color: "var(--ink-muted)" }}
          >
            Help center
          </Link>
          <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>
            /
          </span>
          <Link
            href="/help/guides"
            className="rounded-[4px] font-medium transition-colors hover:text-[var(--brand-blue-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
            style={{ color: "var(--ink-muted)" }}
          >
            Guides
          </Link>
          <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>
            /
          </span>
          <span>{guide.section}</span>
        </nav>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase"
          style={{
            color: "var(--brand-blue-deep)",
            background: "var(--brand-blue-soft)",
            letterSpacing: "0.05em",
          }}
        >
          Step-by-step guide
        </span>
        {isAdmin && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase"
            style={{
              color: "var(--amber-text)",
              background: "var(--amber-soft)",
              letterSpacing: "0.05em",
            }}
          >
            Internal · admins only
          </span>
        )}
      </div>

      <h1
        className="mt-3.5"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(28px, 4.5vw, 34px)",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: 1.15,
          color: "var(--ink)",
          margin: "14px 0 0",
        }}
      >
        {guide.title}
      </h1>

      <p className="mt-2.5 text-[15px]" style={{ color: "var(--ink-muted)", lineHeight: 1.6 }}>
        {guide.blurb}
      </p>

      <div
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-1 text-[12.5px]"
        style={{ color: "var(--ink-faint)" }}
      >
        {stepCount > 0 && (
          <span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{stepCount}</span> steps
          </span>
        )}
        {minutes != null && (
          <span>
            about <span style={{ fontFamily: "var(--font-mono)" }}>{minutes}</span> minutes
          </span>
        )}
      </div>

      <div
        aria-hidden="true"
        className="mt-3 h-0.5 w-full"
        style={{ background: "var(--gradient-link-spine)", opacity: 0.5, borderRadius: 2 }}
      />
    </header>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`Step ${done} of ${total}`}
      className="h-1 w-full overflow-hidden"
      style={{ background: "var(--surface-2)", borderRadius: 2 }}
    >
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          background: "var(--gradient-link-spine)",
          borderRadius: 2,
          transition: "width var(--duration) var(--ease-out)",
        }}
      />
    </div>
  );
}

function StepSidebar({ steps, activeIndex }: { steps: StepMeta[]; activeIndex: number }) {
  return (
    <nav
      aria-label="Guide steps"
      className="sticky top-6 overflow-y-auto"
      style={{ maxHeight: "calc(100vh - 64px)" }}
    >
      <p
        className="m-0 text-[11px] font-semibold uppercase"
        style={{ color: "var(--ink-faint)", letterSpacing: "0.06em" }}
      >
        Steps
      </p>
      <p className="mb-2 mt-1.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {activeIndex + 1}/{steps.length}
        </span>
      </p>
      <ProgressBar done={activeIndex + 1} total={steps.length} />
      <ol className="mt-3 list-none space-y-0 p-0">
        {steps.map((s, i) => {
          const active = i === activeIndex;
          return (
            <li key={s.id} className="m-0">
              <a
                href={`#${s.id}`}
                aria-current={active ? "true" : undefined}
                className="block py-1.5 pl-2.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)]"
                style={{
                  borderLeft: `2px solid ${active ? "var(--brand-blue)" : "var(--border)"}`,
                  color: active ? "var(--brand-blue-deep)" : "var(--ink-muted)",
                  fontWeight: active ? 600 : 400,
                  textDecoration: "none",
                  lineHeight: 1.45,
                }}
              >
                {s.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileStepList({
  steps,
  activeIndex,
  className,
}: {
  steps: StepMeta[];
  activeIndex: number;
  className?: string;
}) {
  return (
    <details
      className={`mt-5 ${className ?? ""}`}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-semibold"
        style={{ color: "var(--ink)" }}
      >
        <span>
          Step{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {activeIndex + 1} of {steps.length}
          </span>
          <span className="font-normal" style={{ color: "var(--ink-muted)" }}>
            {" "}
            · {steps[activeIndex]?.title}
          </span>
        </span>
        <svg
          data-disclosure-chevron=""
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ color: "var(--ink-faint)" }}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      <div className="px-4 pb-3">
        <ProgressBar done={activeIndex + 1} total={steps.length} />
        <ol className="mt-2.5 list-none space-y-0 p-0">
          {steps.map((s, i) => (
            <li key={s.id} className="m-0">
              <a
                href={`#${s.id}`}
                className="flex gap-2.5 py-1.5 text-[13px]"
                style={{
                  color: i === activeIndex ? "var(--brand-blue-deep)" : "var(--ink-muted)",
                  fontWeight: i === activeIndex ? 600 : 400,
                  textDecoration: "none",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}>
                  {s.n}
                </span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </details>
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
    <div
      className="flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
      }}
    >
      <span className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>
        Did this guide get you there?
      </span>
      {answer === null ? (
        <div className="flex items-center gap-2" role="group" aria-label="Did this guide get you there?">
          {(["yes", "no"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => vote(v)}
              className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
              style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface)" }}
            >
              {v === "yes" ? "Yes" : "Not quite"}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-[13px]" style={{ color: "var(--brand-green-deep)" }} role="status">
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
    <div
      className="flex flex-col items-start gap-2 px-5 py-4"
      style={{
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--amber)",
        borderRadius: "0 var(--radius-lg) var(--radius-lg) 0",
        background: "var(--amber-soft)",
      }}
    >
      <p className="m-0 text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
        Internal runbook
      </p>
      <p className="m-0 text-[13px]" style={{ color: "#3C4860", lineHeight: 1.6 }}>
        This page is served only to email addresses on the admin allowlist. It is not in the
        sitemap, it is disallowed in robots.txt, and it is not linked from the public help
        center. Keep customer-specific values out of it — put those in the QA notes instead.
      </p>
      <p className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        <Link href="/admin/guides" style={{ color: "var(--brand-blue-deep)" }} className="hover:underline">
          All runbooks
        </Link>
        <Link href="/admin" style={{ color: "var(--brand-blue-deep)" }} className="hover:underline">
          ← Back to the admin dashboard
        </Link>
      </p>
    </div>
  );
}
