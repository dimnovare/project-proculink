import Link from "next/link";
import { Card } from "@/components/bridge/layout/Card";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { ClosingCta, SITE, Ticks } from "@/components/marketing/sitePictures";

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

export function UseCasePage({ page }: { page: UseCase }) {
  const { example } = page;
  return (
    <div className={SITE_PAGE}>
      <section aria-label="Introduction" className="pb-14 pt-12 sm:pb-20 sm:pt-[72px]">
        <div className={`${SITE.wrap} flex max-w-[1160px] flex-col gap-[26px]`}>
          <h1 className={`${SITE.h1} max-w-[900px] !text-[clamp(38px,5vw,64px)]`}>{page.h1}</h1>
          <p className={`${SITE.lead} max-w-[680px]`}>{page.lead}</p>
          <div className="flex flex-col gap-x-7 gap-y-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href="/sign-up" className={SITE.cta}>Start your free trial</Link>
            <Link href="/how-it-works" className={`${SITE.more} self-center sm:self-auto`}>See how it works</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="problem-title" className="bg-surface py-16 sm:py-20">
        <div className={`${SITE.wrap} flex max-w-[820px] flex-col gap-4`}>
          <h2 id="problem-title" className={SITE.h2}>{page.problem.title}</h2>
          {page.problem.body.map((p) => (
            <p key={p} className="m-0">{p}</p>
          ))}
        </div>
      </section>

      <section aria-labelledby="example-title" className={SITE.band}>
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="example-title" className={SITE.h2}>An example, in and out</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card edge="blue" title="What arrived" sub={example.inName}>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
                {example.inFields.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className={SITE.soft}>{label}</dt>
                    <dd className="m-0 font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[14px]">
                  <thead>
                    <tr>{example.inTable.head.map((h) => <th key={h} className={`${CELL} font-semibold`}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {example.inTable.rows.map((row) => (
                      <tr key={row.join()}>{row.map((c, i) => <td key={i} className={CELL}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card edge="green" title="What we send" sub={example.outName}>
              <pre className="m-0 overflow-x-auto whitespace-pre font-mono text-[14px] leading-[1.6]">{example.outLines.join("\n")}</pre>
            </Card>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="bg-surface py-16 sm:py-20">
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="steps-title" className={SITE.h2}>How it works</h2>
          <ol className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {page.steps.map(([title, body], i) => (
              <li key={title} className="flex flex-col gap-2">
                <span className={`font-display ${SITE.soft}`}>Step {i + 1}</span>
                <h3 className={`${SITE.h3} m-0`}>{title}</h3>
                <p className="m-0">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="today-title" className={SITE.band}>
        <div className={`${SITE.wrap} grid gap-10 lg:grid-cols-2`}>
          <div className="flex flex-col gap-4">
            <h2 id="today-title" className={SITE.h2}>What it does today</h2>
            <Ticks items={page.works} label="What it does today" />
          </div>
          <div className="flex flex-col gap-4">
            <h2 className={SITE.h2}>What it does not do</h2>
            <ul className="m-0 flex list-disc flex-col gap-2.5 pl-5">
              {page.limits.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </div>
        <nav aria-label="Read more" className={`${SITE.wrap} mt-10 flex flex-wrap gap-x-7`}>
          {page.links.map(([label, href]) => (
            <Link key={href} href={href} className={SITE.more}>{label}</Link>
          ))}
        </nav>
      </section>

      <ClosingCta />
    </div>
  );
}
