import { Children, isValidElement } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { COMPANY_TRUST_LINE } from "@/lib/legal-entity";
import { SITE } from "@/components/marketing/sitePictures";

// The one template the five legal pages share. Server component: no hooks.
//
// The legal text is whatever the page passes as children, untouched; this file
// only lays it out. Everything this file adds itself (the related-pages row,
// "On this page", the "Published by" line, "Back to the top") is a <nav> or is
// marked data-legal-chrome, so src/test/legalTextPinned.test.tsx keeps hashing
// only the page's own words.
//
// Headings stay flat siblings inside the one body element (legalCommitments.test
// walks from an h2 to the next h2), and "On this page" is read from the LegalH2
// children so a title is never typed twice.

export const LEGAL_PAGES: readonly (readonly [label: string, path: string])[] = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Acceptable use", "/aup"],
  ["Data processing addendum", "/dpa"],
  ["Subprocessors", "/subprocessors"],
];

export function legalAnchor(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function LegalH2({ children }: { children: string }) {
  return (
    <h2
      id={legalAnchor(children)}
      className="mb-4 mt-12 scroll-mt-24 font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] [text-wrap:balance] first:mt-0"
    >
      {children}
    </h2>
  );
}

/** The page frame of the small site pages: warm paper, 17px text. */
export const SITE_PAGE = "bg-bgWarm text-[17px] leading-[1.55] text-ink";

/** The navy button that makes a request real, sized like SITE.cta. */
export const INK_CTA =
  "inline-flex h-[52px] items-center justify-center gap-2 rounded-[10px] bg-navy px-[26px] text-[17px] font-semibold text-white no-underline hover:bg-navy-surface hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

/** The one "On this page" box of the public pages: collapsed, a row per section. `items` are [anchor id, label]. */
export function OnThisPage({ items, className = "" }: { items: readonly (readonly [id: string, label: string])[]; className?: string }) {
  return (
    <nav aria-label="On this page" className={className}>
      <details className="group rounded-[10px] border border-border px-4">
        {/* `flex` drops the native marker, so the chevron says the box opens. */}
        <summary className="flex min-h-[52px] cursor-pointer items-center justify-between font-semibold">
          On this page
          <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        {items.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="flex min-h-[44px] items-center border-t border-border-faint text-[16px] text-ink no-underline">
            {label}
          </a>
        ))}
      </details>
    </nav>
  );
}

const BODY =
  "min-w-0 max-w-[72ch] text-[17px] leading-[1.65] [&_a]:text-brand-blue-deep [&_a]:underline [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-[20px] [&_h3]:font-semibold [&_li]:mb-2 [&_p]:mb-4 [&_strong]:font-semibold [&_table]:mb-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[15.5px] [&_table]:leading-[1.4] [&_td:first-child]:font-semibold [&_td]:border-b [&_td]:border-border-faint [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-bg [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:font-semibold [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6";

export function LegalPage({
  title,
  updated,
  path,
  children,
}: {
  title: string;
  updated: React.ReactNode;
  path: string;
  children: React.ReactNode;
}) {
  const toc = Children.toArray(children)
    .filter((c): c is React.ReactElement<{ children: string }> => isValidElement(c) && c.type === LegalH2)
    .map((c) => c.props.children);
  const tocLink = (t: string, cls: string) => (
    <a key={t} href={`#${legalAnchor(t)}`} className={cls}>
      {t}
    </a>
  );

  return (
    <div className={SITE_PAGE}>
      <section className="pb-7 pt-12 sm:pt-16">
        <div className={`${SITE.wrap} flex flex-col gap-4`}>
          <nav aria-label="Related legal pages">
            <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-0 sm:flex sm:flex-wrap sm:gap-x-7 sm:gap-y-0">
              {LEGAL_PAGES.map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={href === path ? "page" : undefined}
                    className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-ink-muted no-underline underline-offset-8 hover:text-ink hover:underline aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:decoration-2"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <h1 className={SITE.docH1}>
            {title}
          </h1>
          <div className={`${SITE.soft} text-[16px]`}>
            <p>{updated}</p>
            <p data-legal-chrome>{`Published by ${COMPANY_TRUST_LINE}.`}</p>
          </div>
        </div>
      </section>

      <section className="bg-surface pb-24 pt-14">
        <div className={`${SITE.wrap} flex items-start gap-x-[88px]`}>
          <nav aria-label="On this page" className="sticky top-6 hidden w-[250px] shrink-0 min-[900px]:block">
            <p className="text-[15px] font-semibold">On this page</p>
            <ol className="m-0 mt-3 list-none border-l border-border p-0">
              {toc.map((t) => (
                <li key={t}>
                  {tocLink(
                    t,
                    "-ml-px flex min-h-[40px] items-center border-l-2 border-transparent py-1.5 pl-4 text-[15px] leading-[1.35] text-ink-muted no-underline hover:text-ink",
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 flex-1">
            <OnThisPage items={toc.map((t) => [legalAnchor(t), t] as const)} className="mb-8 min-[900px]:hidden" />

            <div data-testid="legal-body" className={BODY}>
              {children}
            </div>

            <p data-legal-chrome className="mt-7 border-t border-border pt-7">
              <a href="#main-content" className={SITE.more}>
                Back to the top
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
