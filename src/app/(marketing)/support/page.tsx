import { Suspense } from "react";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { Card } from "@/components/bridge/layout/Card";
import { ContactForm, ContactFormFromAddress } from "@/components/marketing/ContactForm";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { SITE } from "@/components/marketing/sitePictures";

export const metadata = pageMetadata({
  path: "/support",
  title: "Support — ProcuLink",
  description:
    "Get help with ProcuLink: answers on billing and plans, data and privacy, and legal — plus how to report a problem and what to include so we can reproduce it.",
  ogDescription:
    "Answers on billing, data and privacy, and legal — plus how to report a problem to the ProcuLink team.",
});

const REPORT = [
  "What you were trying to do",
  "What happened instead",
  "Which document or flow it was",
  "Your browser and device",
  "Any message you saw on screen",
];

const QUESTIONS: Array<[title: string, detail: string, href: string]> = [
  ["Billing and plans", "What each plan includes, and what counts as a document", "/pricing"],
  ["Data and privacy", "What we collect and how long we keep it", "/privacy"],
  ["Security", "Encryption, EU-region document storage and how AI is used", "/security"],
  ["Terms and legal", "Terms, acceptable use and the data processing addendum", "/terms"],
];

const BLOCK = "flex flex-col items-start gap-2.5";
const MAIL = "font-semibold text-brand-blue-deep underline";

export default function SupportPage() {
  return (
    <div className={SITE_PAGE}>
      <section aria-label="Page title" className="pb-12 pt-16">
        <div className={`${SITE.wrap} flex flex-col gap-4`}>
          <h1 className="m-0 font-display text-[clamp(38px,4.2vw,56px)] font-semibold leading-[1.04] tracking-[-0.02em]">
            Support
          </h1>
          <p className={`${SITE.lead} max-w-[720px]`}>
            Need help with ProcuLink? Here&apos;s how to reach us and find answers.
          </p>
        </div>
      </section>

      <section aria-label="Contact us" className="bg-surface pb-[88px] pt-16">
        {/* One column below 860px: the address and hours first, then the form, then what
            to include. `contents` lets the aside's two blocks take their own places. */}
        <div className={`${SITE.wrap} flex flex-col gap-10 min-[860px]:flex-row min-[860px]:items-start min-[860px]:gap-x-[88px]`}>
          <Card className="min-w-0 min-[860px]:flex-[1.4_1_480px]">
            {/* ContactFormFromAddress prefills its subject from ?order= / ?problem= (the
                "Get help with this order" link on a stuck order), which means it reads
                useSearchParams. This boundary is REQUIRED, not decorative: without it
                `next build` fails outright with "useSearchParams() should be wrapped in a
                suspense boundary at page /support". Its fallback is the same form, so the
                first paint is already the form and nothing jumps when the address is read. */}
            <Suspense fallback={<ContactForm initialSubject="" />}>
              <ContactFormFromAddress />
            </Suspense>
          </Card>

          <div className="contents min-[860px]:flex min-[860px]:min-w-0 min-[860px]:flex-[1_1_320px] min-[860px]:flex-col min-[860px]:gap-8">
            <div className={`${BLOCK} -order-1 min-[860px]:order-none`}>
              <h2 className={SITE.h3}>Email support</h2>
              <a href="mailto:support@proculink.eu" className="inline-flex min-h-[44px] items-center text-[20px] font-semibold text-brand-blue-deep">
                support@proculink.eu
              </a>
              <p className={SITE.soft}>Monday to Friday, 9am to 6pm EET. We aim to reply within one business day.</p>
            </div>
            <div className={`${BLOCK} border-t border-border pt-7`}>
              <h2 id="report-a-bug" className={`${SITE.h3} scroll-mt-24`}>
                Report a problem
              </h2>
              <p>When something isn&apos;t working, tell us:</p>
              <ul className="m-0 list-disc pl-6">
                {REPORT.map((r) => (
                  <li key={r} className="mb-1.5">{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="support-questions" className="py-[88px]">
        <div className={`${SITE.wrap} flex flex-wrap items-start gap-x-14 gap-y-8`}>
          <h2 id="support-questions" className="flex-[1_1_280px] font-display text-[clamp(28px,3vw,38px)] font-semibold leading-[1.1] tracking-[-0.02em]">
            Common questions
          </h2>
          <ul className="m-0 min-w-0 flex-[2.4_1_560px] list-none border-b border-border p-0">
            {QUESTIONS.map(([title, detail, href]) => (
              <li key={href} className="border-t border-border">
                <Link
                  href={href}
                  className="flex min-h-[44px] flex-wrap items-baseline gap-x-6 gap-y-1.5 py-3.5 text-ink no-underline hover:text-brand-blue-deep"
                >
                  <strong className="flex-[0_0_170px] font-semibold">{title}</strong>
                  <span className={`${SITE.soft} flex-[1_1_260px]`}>{detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="Other ways to get help" className="bg-surface pb-[104px] pt-[88px]">
        <div className={`${SITE.wrap} grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-x-14 gap-y-10`}>
          <div className={BLOCK}>
            <h2 className={SITE.h3}>Find it yourself</h2>
            <p>Most questions about documents, flows and destinations are answered in the help centre.</p>
            <div className="flex flex-col items-start">
              <Link href="/help" className={SITE.more}>Search the help centre</Link>
              <Link href="/help/guides" className={SITE.more}>Follow a step-by-step guide</Link>
            </div>
          </div>
          <div className={BLOCK}>
            <h2 className={SITE.h3}>Security issues</h2>
            <p>
              Found a security problem? Write to{" "}
              <a href="mailto:security@proculink.eu" className={MAIL}>security@proculink.eu</a>.
            </p>
            <Link href="/security" className={SITE.more}>How we protect your documents</Link>
          </div>
          <div className={BLOCK}>
            <h2 className={SITE.h3}>Enterprise and partnerships</h2>
            <p>
              For larger volumes, a custom agreement or working together, write to{" "}
              <a href="mailto:hello@proculink.eu" className={MAIL}>hello@proculink.eu</a>.
            </p>
            <Link href="/book-demo" className={SITE.more}>Or book a 20-minute call</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
