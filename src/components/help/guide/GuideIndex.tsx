// Shared index body for the guide taxonomy. Rendered by two routes:
//
//   /help/guides  → audience="client", the public library.
//   /admin/guides → audience="admin",  the internal runbooks (allowlist-gated).
//
// The public index deliberately does NOT list the Admin section. An admin guide
// is served only behind the allowlist, and a public row pointing at it would
// advertise a URL that every customer would get a 404 from — and would leak the
// runbook titles. The admin index lists the admin sections and links across to
// the public library.
//
// A "planned" guide renders as a non-link row with a Coming soon tag. Where the
// reference article for that task already exists, the row offers it, so the
// index never shows a reader a dead end.

import Link from "next/link";
import {
  GUIDE_SECTIONS,
  SECTION_BLURB,
  guidesInSection,
  type Guide,
  type GuideAudience,
  type GuideSection,
} from "@/lib/guides";
import { resolveArticles } from "@/lib/help-articles";

export function GuideIndex({ audience }: { audience: GuideAudience }) {
  const sections = GUIDE_SECTIONS.filter((section) =>
    guidesInSection(section).some((g) => g.audience === audience),
  );

  return (
    <div className="mt-9 space-y-9">
      {sections.map((section) => (
        <GuideSectionBlock key={section} section={section} audience={audience} />
      ))}
    </div>
  );
}

function GuideSectionBlock({
  section,
  audience,
}: {
  section: GuideSection;
  audience: GuideAudience;
}) {
  const guides = guidesInSection(section).filter((g) => g.audience === audience);
  const liveCount = guides.filter((g) => g.status === "live").length;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {section}
        </h2>
        <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {liveCount}/{guides.length}
          </span>{" "}
          written
        </span>
      </div>
      <p className="mt-1 text-[13.5px]" style={{ color: "var(--ink-muted)" }}>
        {SECTION_BLURB[section]}
      </p>

      <div
        className="mt-3 overflow-hidden"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {guides.map((guide, i) => (
          <GuideRow key={guide.slug} guide={guide} first={i === 0} />
        ))}
      </div>
    </section>
  );
}

function GuideRow({ guide, first }: { guide: Guide; first: boolean }) {
  const divider = first ? undefined : { borderTop: "1px solid var(--border)" };

  if (guide.status !== "live") {
    const fallback = resolveArticles(guide.related, 2);
    return (
      <div className="px-[18px] py-[13px]" style={divider}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium" style={{ color: "var(--ink-muted)" }}>
            {guide.title}
          </span>
          <span
            className="rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold uppercase"
            style={{
              color: "var(--ink-faint)",
              background: "var(--surface-2)",
              letterSpacing: "0.05em",
            }}
          >
            Coming soon
          </span>
        </div>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink-faint)", lineHeight: 1.55 }}>
          {guide.blurb}
        </p>
        {fallback.length > 0 && (
          <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
            Until then:{" "}
            {fallback.map((a, i) => (
              <span key={a.slug}>
                {i > 0 && " · "}
                <Link
                  href={`/help/${a.slug}`}
                  className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
                  style={{ color: "var(--brand-blue-deep)" }}
                >
                  {a.title}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    );
  }

  return (
    <Link
      href={guide.href}
      className="group flex items-center justify-between gap-3 px-[18px] py-[14px] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)]"
      style={{ ...divider, textDecoration: "none" }}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
            {guide.title}
          </span>
          {guide.minutes != null && (
            <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{guide.minutes}</span> min
            </span>
          )}
        </span>
        <span
          className="mt-1 block text-[12.5px]"
          style={{ color: "var(--ink-muted)", lineHeight: 1.55 }}
        >
          {guide.blurb}
        </span>
      </span>
      <span
        className="shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
        style={{ color: "var(--ink-faint)" }}
        aria-hidden="true"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
