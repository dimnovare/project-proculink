import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { PriceHelper } from "@/components/marketing/PriceHelper";
import { ClosingCta, FLOW_SENTENCE, SITE, Ticks } from "@/components/marketing/sitePictures";
import { euro } from "@/lib/billingWords";
import {
  DOCUMENT_PLAN_FEATURES,
  DOCUMENT_PLAN_IDS,
  DOCUMENT_UNIT_SENTENCE,
  ENTERPRISE_FLOOR_EUR,
  LEGACY_PAID_PLANS,
  PLAN_BY_ID,
  TRIAL_DAYS,
} from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Pricing — a static server page. Every price, allowance and plan name is read from
// src/lib/plans.ts. The only client code is PriceHelper (the billing period, the volume
// slider, its answer and the four paid plans), whose first state is in this page's HTML.
//
// Every plan block carries `data-plans` with the ids whose text it holds, so
// gatedCapabilityClaims can check each bullet against every plan it is sold on. The legacy
// paid plans are hidden here; their names appear only in the "older plan" answer, derived
// from LEGACY_PAID_PLANS.
// ─────────────────────────────────────────────────────────────────────────────

const TRIAL = PLAN_BY_ID.pilot;
const ENTERPRISE = PLAN_BY_ID.enterprise;

/** "A, B, C or D" */
const joinNames = (names: string[]) => `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

const LEGACY_PLAN_NAMES = joinNames(LEGACY_PAID_PLANS.map((p) => p.name));

const LINK = "font-semibold underline underline-offset-[3px]";

// Answers are ReactNode so an answer can link to the page that owns the detail. Native
// <details>, so every answer opens without script and is never clipped by a height.
const FAQ: Array<[string, ReactNode]> = [
  [
    "Do I need an integration to start?",
    "No. Upload a file or forward an email and you have a result to check. The API and the server pickups are there for when you want documents to arrive by themselves.",
  ],
  [
    "Do the people who send me documents need to change anything?",
    "No. They keep sending documents the way they do today. You upload what arrives, forward it to your flow's own email address, or let us collect it from a mailbox or a server.",
  ],
  [
    "Can I try it with a test or anonymised document?",
    `Yes. Use a test file, or blank out anything sensitive first. It is read like any other document, and it counts towards your ${TRIAL.orderLimit} trial documents.`,
  ],
  [
    "Will anything be sent automatically during the trial?",
    "Only where you choose. A file goes somewhere only once you give its flow a destination; until then you download it. A new flow an admin creates holds any document with a marked value for you, and you can set a flow to check every document.",
  ],
  [
    "What happens when the trial ends?",
    "Your workspace becomes read-only. You can still open and export everything, but new documents aren't accepted until you choose a plan.",
  ],
  [
    "Can I change plans later?",
    "Yes. Upgrade any time in Settings, under Plan & billing; we prorate the difference. To move to a smaller plan, contact us.",
  ],
  // Cancelling is the one plan change that stops documents arriving, and it used to be
  // undisclosed: "upgrade any time" reads as though cancelling is just another move along the
  // ladder. It is not — every ingest path refuses once the subscription ends, and nothing is
  // queued for later, so a sender who keeps emailing documents gets silence. Say so before the
  // buyer pays. Pinned by cancelDisclosure.test.tsx.
  [
    "What happens if I cancel?",
    <>
      If you cancel, ProcuLink stops accepting new documents when your subscription ends. Everything you have already processed remains readable and exportable — past documents, flows and outputs stay until you ask us to delete them, and activity records such as delivery attempts are removed after 180 days (see the{" "}
      <Link href="/privacy" className={LINK}>Privacy Policy</Link>) — but nothing new comes in on any route: uploads, emailed documents and the file API all stop, and mailbox, SFTP, FTP, FTPS and S3 pickups pause and leave your files where they are. Uploads, emails and API calls sent after that are not held for later, so tell your senders before you cancel. Resubscribing turns processing back on immediately, with your setup untouched.
    </>,
  ],
  // STORED and PROCESSED are two different questions. Storage is EU-region; some processing
  // runs on named US subprocessors. The answer says no more than that, in the same words the
  // fine print and the footers use (legalCommitments.test.tsx).
  [
    "Where is my data stored?",
    <>
      Document storage is EU-region and encrypted with AES-GCM at rest. Some processing runs on named US subprocessors under standard contractual clauses — sign-in, AI extraction, payments, and email in both directions, including the documents we email to the destinations you set. See the{" "}
      <Link href="/security" className={LINK}>Security page</Link> for the full posture.
    </>,
  ],
  [
    "I'm on an older plan. What changes?",
    `If you are on ${LEGACY_PLAN_NAMES}, nothing changes until you change plan. You keep your current price and limits. To change plan, go to Settings, then Plan & billing.`,
  ],
];

/** From 1100px a row's heading sits in the plans' label column. */
const ROW = "flex flex-col gap-3.5 border-t border-border py-6 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,208fr)_minmax(0,904fr)] min-[1100px]:gap-0";

export default function PricingPage() {
  return (
    <div className="bg-bgWarm text-[17px] leading-[1.55] text-ink">
      <section aria-labelledby="pricing-title" className="pb-[88px] pt-12 sm:pt-[72px]">
        <div className={`${SITE.wrap} flex flex-col gap-12`}>
          <div className="flex max-w-[880px] flex-col gap-[22px]">
            <h1 id="pricing-title" className={SITE.h1}>Start free. Pay for the documents you process.</h1>
            <p className={`${SITE.lead} max-w-[700px]`}>
              Every plan has every way to send documents in, every output and every check. Plans differ only by how many documents you process and how many flows you set up.
            </p>
            <p className={`${SITE.soft} text-[16px]`}>{FLOW_SENTENCE}</p>
            <p className={`${SITE.soft} text-[16px]`}>{DOCUMENT_UNIT_SENTENCE}</p>
          </div>

          <Card as="article" edge="none" pad="clamp(24px,3vw,36px) clamp(20px,3.4vw,40px)" data-plans={TRIAL.id} className="flex flex-wrap items-center gap-x-10 gap-y-5">
            <div className="flex flex-col gap-2">
              <h2 className={SITE.h3}>{TRIAL.name}</h2>
              <p className="font-display text-[clamp(34px,3.6vw,48px)] font-semibold leading-none tracking-[-0.02em] text-brand-green-deep">
                {`${TRIAL.priceLabel} for ${TRIAL_DAYS} days`}
              </p>
            </div>
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-1.5">
              <p className="text-[19px] font-semibold leading-[1.35] [text-wrap:pretty]">
                {`${TRIAL.orderLimit}\u00a0documents, ${TRIAL.flowLimit}\u00a0flows, no credit card.`}
              </p>
              <p className={`${SITE.soft} text-[16px] [text-wrap:pretty]`}>
                When the trial ends, your workspace becomes read-only until you choose a plan.
              </p>
            </div>
            <Link href={TRIAL.cta.href} className={`${SITE.cta} w-full shrink-0 sm:w-auto`}>{TRIAL.cta.label}</Link>
          </Card>
        </div>
      </section>

      <section aria-labelledby="choose-title" className={`${SITE.band} bg-surface`}>
        <div className={`${SITE.wrap} flex flex-col gap-7`}>
          <PriceHelper heading={<h2 id="choose-title" className={`${SITE.h2} max-w-[640px]`}>After the trial, choose by volume.</h2>} />

          <div className="border-b border-border">
            <div data-plans={DOCUMENT_PLAN_IDS.join(" ")} className={ROW}>
              <h3 className={`${SITE.h3} min-[1100px]:pr-4`}>On every paid plan</h3>
              <Ticks items={DOCUMENT_PLAN_FEATURES} className="min-[1100px]:pl-5" />
            </div>
            <article data-plans={ENTERPRISE.id} className={`${ROW} min-[1100px]:items-center`}>
              <h3 className={`${SITE.h3} min-[1100px]:pr-4`}>{ENTERPRISE.name}</h3>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 min-[1100px]:pl-5">
                <p className={`${SITE.soft} flex-[1_1_320px]`}>
                  {`Custom volume, dedicated onboarding and an SLA. From ${euro(ENTERPRISE_FLOOR_EUR)} a month.`}
                </p>
                <a href={ENTERPRISE.cta.href} className={SITE.more}>{ENTERPRISE.cta.label}</a>
              </div>
            </article>
          </div>

          <div data-testid="pricing-fine-print" className={`${SITE.soft} flex max-w-[860px] flex-col gap-2.5 text-[15px]`}>
            <p>
              Going over a paid plan never blocks you. Each extra document is billed at your plan&apos;s rate, and where a larger plan would have covered the month, you never pay more than that plan&apos;s monthly price.
            </p>
            <p>
              All plans include <Link href="/security" className={LINK}>EU-region document storage</Link> and AES-GCM encryption. Where each subprocessor runs is{" "}
              <Link href="/subprocessors" className={LINK}>listed in full</Link>.
            </p>
            {/* Cancelling is the one thing on this page a buyer can get wrong expensively, and the
                answer below is inside a question, so the headline consequence also sits here. */}
            <p>
              Cancel any time. New documents stop arriving on every channel once your subscription ends — what you have already processed stays available to read and export.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="questions-title" className={SITE.band}>
        <div className={`${SITE.wrap} flex flex-wrap items-start gap-x-[72px] gap-y-8`}>
          <div className="flex flex-[1_1_300px] flex-col gap-4">
            <h2 id="questions-title" className={SITE.h2}>Questions, answered</h2>
            <p className={SITE.soft}>
              Something else on your mind? <Link href="/book-demo" className={LINK}>Talk to us</Link>
            </p>
          </div>
          <div className="min-w-0 flex-[2.2_1_560px] border-t border-border">
            {FAQ.map(([q, a], i) => (
              <details key={q} className="group border-b border-border" open={i === 0}>
                <summary className="flex min-h-[68px] cursor-pointer list-none items-center gap-4 py-2 font-display text-[21px] font-semibold leading-[1.25] tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 [text-wrap:pretty]">{q}</span>
                  <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-ink-muted group-open:rotate-180 motion-safe:transition-transform" />
                </summary>
                <div className="max-w-[740px] pb-6 pr-10 text-ink-muted">{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta title="Not sure which plan fits?" lead="Start the free trial and see how many documents you process." />
    </div>
  );
}
