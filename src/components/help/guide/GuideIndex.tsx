// Shared index body for the guide taxonomy. Rendered by two routes:
//
//   /help/guides:  audience="client", the public library.
//   /admin/guides: audience="admin",  the internal runbooks (allowlist-gated).
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
import { Card } from "@/components/bridge/layout/Card";
import { SITE } from "@/components/marketing/sitePictures";

const ROW = "flex flex-col gap-1 border-t border-border py-3 first:border-t-0";

export function GuideIndex({ audience }: { audience: GuideAudience }) {
  const sections = GUIDE_SECTIONS.filter((section) =>
    guidesInSection(section).some((g) => g.audience === audience),
  );

  return (
    <div className="mt-10 flex flex-col gap-12">
      {sections.map((section) => (
        <GuideSectionBlock key={section} section={section} audience={audience} />
      ))}
    </div>
  );
}

function GuideSectionBlock({ section, audience }: { section: GuideSection; audience: GuideAudience }) {
  const guides = guidesInSection(section).filter((g) => g.audience === audience);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">{section}</h2>
      <p className={`${SITE.soft} m-0`}>{SECTION_BLURB[section]}</p>
      <Card edge="none" className="mt-2">
        {guides.map((guide) => (
          <GuideRow key={guide.slug} guide={guide} />
        ))}
      </Card>
    </section>
  );
}

function GuideRow({ guide }: { guide: Guide }) {
  if (guide.status !== "live") {
    const fallback = resolveArticles(guide.related, 2);
    return (
      <div className={ROW}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-muted">{guide.title}</span>
          <span className="rounded-full bg-surface-2 px-2.5 text-[13px] font-semibold text-ink-muted">Coming soon</span>
        </span>
        <span className="text-[15px] text-ink-muted">{guide.blurb}</span>
        {fallback.length > 0 && (
          <span className="text-[15px] text-ink-muted">
            Until then:{" "}
            {fallback.map((a, i) => (
              <span key={a.slug}>
                {i > 0 && " · "}
                <Link href={`/help/${a.slug}`} className="text-brand-blue-deep underline underline-offset-4">
                  {a.title}
                </Link>
              </span>
            ))}
          </span>
        )}
      </div>
    );
  }

  return (
    <Link href={guide.href} className={`${ROW} min-h-[44px] no-underline`}>
      <span className="font-semibold text-brand-blue-deep underline underline-offset-4">{guide.title}</span>
      <span className="text-[15px] text-ink">{guide.blurb}</span>
      {guide.minutes != null && <span className={`${SITE.soft} text-[15px]`}>About {guide.minutes} minutes</span>}
    </Link>
  );
}