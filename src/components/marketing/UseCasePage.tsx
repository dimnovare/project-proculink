import Link from "next/link";
import { Card } from "@/components/bridge/layout/Card";
import { scrollRegionProps } from "@/components/bridge/document/scrollRegion";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { ClosingCta, SITE, Ticks } from "@/components/marketing/sitePictures";
import { useCopy } from "@/i18n/useCopy";
import { MAX_DOCUMENTS_PER_FILE, PAGES_PER_DOCUMENT } from "@/lib/plans";

// One page per problem a visitor searches for. Server-safe. Every sentence in a UseCase is a
// claim the product keeps today: what it does, and just as plainly what it does not.

export interface UseCase {
  path: string;
  h1: string;
  lead: string;
  problem: { title: string; body: readonly string[] };
  example: {
    inName: string;
    inFields: readonly [label: string, value: string][];
    inTable: { head: readonly string[]; rows: readonly (readonly string[])[] };
    outName: string;
    outLines: readonly string[];
  };
  steps: readonly [title: string, body: string][];
  works: readonly string[];
  limits: readonly string[];
  links: readonly [label: string, href: string][];
}

const CELL = "border-t border-border px-2 py-1.5 text-left font-normal";

// The data in useCases.ts stays English; the other languages are keyed by page under "useCases" in messages/<locale>.json.
const COPY_ID: Record<string, string> = { "/invoice-data-extraction": "invoice", "/purchase-order-data-extraction": "order" };

export function UseCasePage({ page }: { page: UseCase }) {
  const { example } = page;
  const { c, list } = useCopy("useCases");
  const id = COPY_ID[page.path] ?? "other";
  const pages = PAGES_PER_DOCUMENT * MAX_DOCUMENTS_PER_FILE;
  return (
    <div className={SITE_PAGE}>
      <section aria-label={c("ui.introLabel", "Introduction")} className="pb-14 pt-12 sm:pb-20 sm:pt-[72px]">
        <div className={`${SITE.wrap} flex max-w-[1160px] flex-col gap-[26px]`}>
          <h1 className={`${SITE.h1} max-w-[900px] !text-[clamp(38px,5vw,64px)]`}>{c(`${id}.h1`, page.h1)}</h1>
          <p className={`${SITE.lead} max-w-[680px]`}>{c(`${id}.lead`, page.lead)}</p>
          <div className="flex flex-col gap-x-7 gap-y-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href="/sign-up" className={SITE.cta}>{c("ui.start", "Start your free trial")}</Link>
            <Link href="/how-it-works" className={`${SITE.more} self-center sm:self-auto`}>{c("ui.howLink", "See how it works")}</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="problem-title" className="bg-surface py-16 sm:py-20">
        {/* The page's left edge, with the measure on the text, so this band lines up with the others. */}
        <div className={SITE.wrap}>
          <div className="flex max-w-[820px] flex-col gap-4">
            <h2 id="problem-title" className={SITE.h2}>{c(`${id}.problem.title`, page.problem.title)}</h2>
            {list(`${id}.problem.body`, page.problem.body).map((p) => (
              <p key={p} className="m-0">{p}</p>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="example-title" className={SITE.band}>
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="example-title" className={SITE.h2}>{c("ui.exampleTitle", "An example, in and out")}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card edge="blue" title={c("ui.arrived", "What arrived")} sub={example.inName}>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
                {example.inFields.map(([label, value], i) => (
                  <div key={label} className="contents">
                    <dt className={SITE.soft}>{c(`${id}.fields.${i}`, label)}</dt>
                    <dd className="m-0 font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[14px]">
                  <thead>
                    <tr>{list(`${id}.head`, example.inTable.head).map((h) => <th key={h} className={`${CELL} font-semibold`}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {example.inTable.rows.map((row) => (
                      <tr key={row.join()}>{row.map((c, i) => <td key={i} className={CELL}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card edge="green" title={c("ui.weSend", "What we send")} sub={example.outName}>
              {/* Long lines scroll sideways, so the box takes focus and a name (as the help code blocks do). */}
              <pre {...scrollRegionProps(c("ui.weSendLabel", `What we send: ${example.outName}`, { name: example.outName }), true)} className="m-0 overflow-x-auto whitespace-pre font-mono text-[14px] leading-[1.6]">{example.outLines.join("\n")}</pre>
            </Card>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="bg-surface py-16 sm:py-20">
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="steps-title" className={SITE.h2}>{c("ui.stepsTitle", "How it works")}</h2>
          <ol className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {page.steps.map(([title, body], i) => (
              <li key={title} className="flex flex-col gap-2">
                <span className={`font-display ${SITE.soft}`}>{c("ui.step", `Step ${i + 1}`, { n: i + 1 })}</span>
                <h3 className={`${SITE.h3} m-0`}>{c(`${id}.steps.${i}.title`, title)}</h3>
                <p className="m-0">{c(`${id}.steps.${i}.body`, body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="today-title" className={SITE.band}>
        <div className={`${SITE.wrap} grid gap-10 lg:grid-cols-2`}>
          <div className="flex flex-col gap-4">
            <h2 id="today-title" className={SITE.h2}>{c("ui.todayTitle", "What it does today")}</h2>
            <Ticks items={list(`${id}.works`, page.works)} label={c("ui.todayTitle", "What it does today")} />
          </div>
          <div className="flex flex-col gap-4">
            <h2 className={SITE.h2}>{c("ui.notTitle", "What it does not do")}</h2>
            <ul className="m-0 flex list-disc flex-col gap-2.5 pl-5">
              {page.limits.map((l, i) => <li key={l}>{c(`${id}.limits.${i}`, l, { pages })}</li>)}
            </ul>
          </div>
        </div>
        <nav aria-label={c("ui.readMore", "Read more")} className={`${SITE.wrap} mt-10 flex flex-wrap gap-x-7`}>
          {page.links.map(([label, href], i) => (
            <Link key={href} href={href} className={SITE.more}>{c(`${id}.links.${i}`, label)}</Link>
          ))}
        </nav>
      </section>

      <ClosingCta />
    </div>
  );
}
