import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { PLAN_BY_ID, TRIAL_DAYS } from "@/lib/plans";
import { useCopy } from "@/i18n/useCopy";
import { BookDemoForm } from "@/components/marketing/BookDemoForm";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { SITE } from "@/components/marketing/sitePictures";

// /book-demo is a 20-minute call about ONE of the visitor's own documents. The route keeps its name:
// it is linked from the app and the marketing site, and BOOK_DEMO_URL (src/lib/book-demo.ts) defaults to it.

export const metadata = pageMetadata({
  path: "/book-demo",
  title: "Book a 20-minute call — ProcuLink",
  description:
    "Show us one of your documents on a 20-minute call. We reply within 1 business day to find a time.",
});

const COVER: Array<[string, string]> = [
  [
    "One of your documents",
    "Bring a PDF, Excel or CSV file you handle by hand, or a test or anonymised one. We can run it through ProcuLink while we talk.",
  ],
  [
    "Whether it fits",
    "If a document you handle again and again looks like a good test case, we'll talk through how ProcuLink would handle it. No obligation either way.",
  ],
];

const TRIAL = PLAN_BY_ID.pilot;

export default function BookDemoPage() {
  const { c } = useCopy("bookDemo");
  return (
    <div className={SITE_PAGE}>
      <section className="pb-[88px] pt-[72px]">
        {/* Two columns from 860px: the intro and what we'll cover on the left, the form on
            the right, the trial aside under the intro. One column below, in that order. */}
        <div className={`${SITE.wrap} grid grid-cols-1 items-start gap-x-[72px] gap-y-10 min-[860px]:grid-cols-2`}>
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-6">
              <h1 className={SITE.docH1}>
                {c("title", "Show us one of your documents")}
              </h1>
              <p className={SITE.lead}>
                {c("lead", "A 20-minute call to look at one document you handle by hand: a purchase order, an invoice, a price list. Tell us a little about the documents you handle today and we'll reply within 1 business day to find a time.")}
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <h2 className="font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.015em]">{c("coverTitle", "What we'll cover")}</h2>
              <ul className="m-0 list-none border-b border-border p-0">
                {COVER.map(([title, detail], i) => (
                  <li key={title} className="flex flex-col gap-1.5 border-t border-border py-5">
                    <h3 className={SITE.h3}>{c(`cover.${i}.title`, title)}</h3>
                    <p className={SITE.soft}>{c(`cover.${i}.detail`, detail)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="min-w-0 min-[860px]:row-span-2">
            <BookDemoForm />
          </div>

          <div className="flex min-w-0 flex-col gap-0.5 min-[860px]:self-end">
            <p className="font-display text-[22px] font-semibold leading-[1.25] tracking-[-0.01em]">
              {c("already", "Already know you want to test it?")}
            </p>
            <div className="flex flex-wrap items-center gap-x-6">
              <Link
                href="/sign-up"
                className="inline-flex min-h-[44px] items-center font-semibold text-brand-blue-deep underline underline-offset-[5px]"
              >
                {c("start", "Start your free trial")}
              </Link>
              <p className={`${SITE.soft} text-[15.5px]`}>
                {c("trial", `Free for ${TRIAL.priceCadence}, ${TRIAL.orderLimit}\u00a0documents, no\u00a0credit\u00a0card.`, { days: TRIAL_DAYS, docs: TRIAL.orderLimit })}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
