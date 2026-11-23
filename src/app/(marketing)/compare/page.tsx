import Link from "next/link";
import { Check, Minus, X } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { COMPARE_ROWS, COMPARE_TOOLS, type CompareCell } from "@/components/marketing/compareRows";
import { TableScroller } from "@/components/marketing/TableScroller";
import { ClosingCta, SITE } from "@/components/marketing/sitePictures";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/compare",
  title: "How ProcuLink compares: a document parser alternative",
  description:
    "Looking for a document parser alternative? See how ProcuLink compares with template-based parsers, general AI extraction tools and typing it in by hand.",
});

const ICONS = {
  yes: { Icon: Check, tone: "text-brand-green-deep" },
  no: { Icon: X, tone: "text-ink-muted" },
  partly: { Icon: Minus, tone: "text-amber-text" },
} as const;

/** One answer: the words say it, the icon only repeats it, so nothing rests on colour. */
function Answer({ cell: [mark, words] }: { cell: CompareCell }) {
  const icon = mark ? ICONS[mark] : null;
  return (
    <span className="flex items-start gap-2">
      {icon ? (
        <icon.Icon aria-hidden="true" className={`mt-[2px] size-[18px] shrink-0 ${icon.tone}`} strokeWidth={2.5} />
      ) : (
        <span aria-hidden="true" className="size-[18px] shrink-0" />
      )}
      <span>{words}</span>
    </span>
  );
}

const BETTER = [
  {
    title: "You are building it into your own app",
    body: "If you are a developer who wants raw values back from an API inside your own product, a general AI extraction tool is made for that.",
  },
  {
    title: "One fixed layout, in very large numbers",
    body: "If every document has the same layout and there are a great many of them, a template set up once can be the cheapest way to read them.",
  },
  {
    title: "A handful of documents a month",
    body: "If only a few documents arrive each month, typing them in may be quicker than setting up any tool.",
  },
];

const CELL = "px-[18px] py-[14px] align-top";

export default function ComparePage() {
  return (
    <div className="bg-bgWarm text-[17px] leading-[1.55] text-ink">
      <section aria-labelledby="compare-title" className="pb-16 pt-12 sm:pb-20 sm:pt-[72px]">
        <div className={`${SITE.wrap} flex flex-col gap-[26px]`}>
          <h1 id="compare-title" className={SITE.h1}>How ProcuLink compares</h1>
          <p className={`${SITE.lead} max-w-[700px]`}>
            There are a few common ways to get data out of documents: a template-based PDF parser, a general AI extraction
            tool, or typing it in by hand. Here is how each one differs from ProcuLink, and when one of them is the better
            choice.
          </p>
        </div>
      </section>

      <section aria-labelledby="table-title" className={`${SITE.band} bg-surface`}>
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <div className="flex max-w-[720px] flex-col gap-3">
            <h2 id="table-title" className={SITE.h2}>Side by side</h2>
            <p className={SITE.soft}>
              Each of the other columns describes a kind of tool, not one product. Where tools of that kind differ, we say so.
            </p>
          </div>

          <Card flush className="hidden lg:block">
            <TableScroller label="How ProcuLink compares">
              <table className="w-full table-fixed border-collapse text-[15.5px] leading-[1.4]">
                <caption className="sr-only">ProcuLink compared with three other ways to get data out of documents</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={`${CELL} w-[24%] text-left`}>
                      <span className="sr-only">What you get</span>
                    </th>
                    {COMPARE_TOOLS.map((tool, i) => (
                      <th key={tool} scope="col" className={`${CELL} text-left text-[15px] font-semibold ${i === 0 ? "text-ink" : "text-ink-muted"}`}>
                        {tool}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&>tr+tr>*]:border-t [&>tr+tr>*]:border-border-faint">
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.name}>
                      <th scope="row" className={`${CELL} text-left font-semibold`}>{row.name}</th>
                      {row.cells.map((cell, i) => (
                        <td key={COMPARE_TOOLS[i]} className={CELL}>
                          <Answer cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          </Card>

          <ul className="m-0 flex list-none flex-col gap-4 p-0 lg:hidden">
            {COMPARE_ROWS.map((row) => (
              <Card as="li" key={row.name}>
                <h3 className={SITE.h3}>{row.name}</h3>
                <dl className="m-0 mt-2">
                  {COMPARE_TOOLS.map((tool, i) => (
                    <div key={tool} className="flex flex-col gap-1 border-t border-border-faint py-3 first:border-t-0 last:pb-0">
                      <dt className={`text-[14px] font-semibold ${i === 0 ? "text-ink" : "text-ink-muted"}`}>{tool}</dt>
                      <dd className="m-0 text-[15.5px] leading-[1.4]">
                        <Answer cell={row.cells[i]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </ul>

          <div className="flex flex-wrap gap-x-7 gap-y-2">
            <Link href="/formats" className={SITE.more}>Every format and method</Link>
            <Link href="/security" className={SITE.more}>Where your data lives</Link>
            <Link href="/pricing" className={SITE.more}>Pricing</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="better-title" className={SITE.band}>
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="better-title" className={SITE.h2}>When another tool is the better choice</h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-12 p-0">
            {BETTER.map((b) => (
              <li key={b.title} className="flex flex-col gap-2 border-t border-border py-6">
                <h3 className={SITE.h3}>{b.title}</h3>
                <p className={`${SITE.soft} text-[16px]`}>{b.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ClosingCta />
    </div>
  );
}
