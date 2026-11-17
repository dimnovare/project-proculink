import Link from "next/link";
import { Code2, Folder, Mail, Upload } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { STAGES } from "@/components/bridge/StatusJourney";
import {
  ClosingCta,
  CsvFile,
  InvoiceSheet,
  ReviewPicture,
  SecondDocumentPicture,
  SITE,
  Ticks,
} from "@/components/marketing/sitePictures";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "@/lib/deliveryMode";
import { pageMetadata } from "@/lib/seo";

const LEAD =
  "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs. Scans and phone photos are read too.";

export const metadata = pageMetadata({ path: "/how-it-works", title: "How it works — ProcuLink", description: LEAD });

const ICON = "mt-0.5 size-5 shrink-0 text-brand-blue";
const ROW = "flex items-start gap-3 border-t border-border-faint px-5 py-4";

function IntakePicture() {
  return (
    <Card
      flush
      role="img"
      aria-label="Four ways to send a document in: upload, the flow's own email address, collection from a mailbox or server, and the API."
      className="overflow-hidden text-[15px]"
    >
      <div aria-hidden="true">
        <div className="p-4">
          <div className="flex flex-col items-center gap-0.5 rounded-xl border-2 border-dashed border-navy-pale px-4 py-5 text-center">
            <Upload className="mb-1.5 size-6 text-brand-blue" />
            <p className="font-semibold">Upload</p>
            <p className={`${SITE.soft} text-[14px]`}>Drag a file in, or choose one.</p>
          </div>
        </div>
        <div className={ROW}>
          <Mail className={ICON} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Email</p>
            <p className={`${SITE.soft} text-[14px]`}>Forward or send to the flow&apos;s own address, shown on the flow.</p>
          </div>
        </div>
        <div className={ROW}>
          <Folder className={ICON} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Collect</p>
            <p className={`${SITE.soft} text-[14px]`}>
              From a mailbox, a server or a bucket. We check every five minutes, and files on your server or in your bucket stay where they are.
            </p>
          </div>
        </div>
        <div className={ROW}>
          <Code2 className={ICON} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">API</p>
            <p className={`${SITE.soft} text-[14px]`}>Your own system posts a file to the flow.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ReadPicture() {
  return (
    <div
      role="img"
      aria-label="An invoice with each value we read marked on the page, and a photographed delivery note behind it."
      className="relative pb-2.5 pt-[62px]"
    >
      <div aria-hidden="true">
        <div className="absolute right-0 top-1 flex h-[70%] w-[58%] rotate-3 flex-col items-end gap-[9px] rounded-[5px] bg-bgWarm px-[18px] py-3.5 shadow-[0_1px_2px_color-mix(in_srgb,var(--navy)_10%,transparent),0_18px_40px_-18px_color-mix(in_srgb,var(--navy)_28%,transparent)]">
          <p className={`${SITE.soft} text-[12.5px]`}>Delivery note, phone photo</p>
          <div className="h-1.5 w-[62%] rounded-[3px] bg-border" />
          <div className="h-1.5 w-[44%] rounded-[3px] bg-border" />
        </div>
        <InvoiceSheet marked className="relative w-[88%] -rotate-[1.5deg]" />
      </div>
    </div>
  );
}

const CHIPS = ["CSV", "Excel", "JSON", "XML", "PDF", "Text", "Fixed-width"];

function SendPicture() {
  return (
    <div className="min-w-0">
      <div role="img" aria-label="A CSV file built from the invoice, sent to an accounting server and to Google Sheets.">
        <div aria-hidden="true">
          <CsvFile
            sent
            head={
              <div className="flex flex-wrap gap-1.5 border-b border-border-faint px-4 py-3.5">
                {CHIPS.map((c, i) => (
                  <span
                    key={c}
                    className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[13px] font-semibold ${
                      i === 0 ? "border-navy bg-navy text-white" : "border-border-strong bg-surface text-ink-muted"
                    }`}
                  >
                    {c}
                  </span>
                ))}
              </div>
            }
          />
        </div>
      </div>
      <p className={`${SITE.soft} pt-3 text-[14.5px]`}>
        Have your receiving system&apos;s documentation? Upload it and we propose the output for you to check.
      </p>
    </div>
  );
}

const STEPS = [
  {
    title: "Send it",
    node: "border-brand-blue",
    lead: "Upload a file, forward an email to the address your flow gives you, or let ProcuLink collect files for you.",
    detail:
      "We can collect from a mailbox, an SFTP, FTP or FTPS server, an S3 bucket, or our API. PDFs with a text layer, CSV and Excel files are read, and so are Word, text, XML and JSON files.",
    picture: <IntakePicture />,
  },
  {
    title: "We read it",
    node: "border-brand-blue",
    lead: "We read every value and every table on the first document, row by row.",
    detail:
      "There is no template to build first, so a new sender with a new layout does not mean new setup. Scans and phone photos are read too.",
    picture: <ReadPicture />,
  },
  {
    title: "You check it",
    node: "border-amber",
    lead: "The original stays on screen beside what we read. Fix a value that is wrong, or draw a box around it on the page so we find it in the same place next time.",
    detail:
      "We flag a value that is missing, in the wrong shape or hard to read, and we hold a document we have already seen instead of sending it twice.",
    picture: <ReviewPicture teach />,
  },
  {
    title: "We send it",
    node: "border-brand-green",
    lead: "Choose CSV, JSON, XML, Excel, PDF, text or fixed-width, then send the result where it needs to go.",
    detail:
      "Send it by email, to a web address, to an SFTP or FTPS server, an S3 bucket, Google Drive or Google Sheets, or download it. Microsoft OneDrive and SharePoint are available on request.",
    picture: <SendPicture />,
  },
];

const PIPELINE: Record<(typeof STAGES)[number], { dot: string; body: string }> = {
  In: { dot: "border-[var(--brand-blue-bright)]", body: "A file arrives by upload, email, a pickup or the API, and becomes a document in its flow." },
  Read: { dot: "border-[var(--brand-blue-bright)]", body: "Every value and table is read, with where on the page it was found and how sure we are." },
  Check: { dot: "border-[var(--amber-bright)]", body: "Built-in checks mark a value that is missing, in the wrong shape or hard to read. A repeated document number is held, and so is the first document from a new email address." },
  Transform: { dot: "border-[var(--brand-green-bright)]", body: "Each output file is built from the read values, with your column names and any lookups applied." },
  Send: { dot: "border-[var(--brand-green-bright)]", body: "The file goes to each destination. Each delivery keeps its attempts, the destination's answer where it gives one and, when it fails, the error." },
};

// Below 360px "Transform it." at 42px is about as wide as the column, so the
// pairs are only held together where there is room for them.
const NOWRAP = "min-[360px]:whitespace-nowrap";
// Clears the sticky header when a step or the pipeline is jumped to.
const JUMP = "scroll-mt-20";

export default function HowItWorksPage() {
  return (
    <div className="bg-bgWarm text-[17px] leading-[1.55] text-ink">
      <section aria-label="Introduction" className="pb-16 pt-12 sm:pb-[88px] sm:pt-[72px]">
        <div className={`${SITE.wrap} flex flex-wrap items-end gap-x-16 gap-y-10`}>
          <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-[26px]">
            <h1 className={SITE.h1}>
              <span className="text-brand-blue">
                <span className={NOWRAP}>Read it.</span> <span className={NOWRAP}>Check it.</span>
              </span>{" "}
              <span className="block text-brand-green-deep">
                <span className={NOWRAP}>Transform it.</span> <span className={NOWRAP}>Send it.</span>
              </span>
            </h1>
            <p className={`${SITE.lead} max-w-[640px]`}>{LEAD}</p>
            <div className="flex flex-col gap-x-7 gap-y-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <Link href="/sign-up" className={SITE.cta}>Start your free trial</Link>
              <a href="#pipeline" className={`${SITE.more} self-center sm:self-auto`}>For technical readers: the pipeline</a>
            </div>
          </div>
          <ol
            aria-label="The four steps"
            className="m-0 min-w-0 flex-[0_1_300px] list-none border-t border-border-strong p-0 text-[16px] max-[980px]:flex-[1_1_100%]"
          >
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <a href={`#step-${i + 1}`} className="flex min-h-[50px] items-center gap-3.5 border-b border-border-strong font-semibold text-ink no-underline">
                  <span className={`w-3.5 font-display ${SITE.soft}`}>{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="The four steps in detail" className={`${SITE.band} bg-surface`}>
        <div className={SITE.wrap}>
          <ol className="relative m-0 flex list-none flex-col gap-16 p-0 min-[700px]:gap-24 min-[700px]:before:absolute min-[700px]:before:bottom-6 min-[700px]:before:left-[19px] min-[700px]:before:top-6 min-[700px]:before:w-0.5 min-[700px]:before:bg-[linear-gradient(var(--brand-blue),var(--brand-green))] min-[700px]:before:content-['']">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                id={`step-${i + 1}`}
                className="relative scroll-mt-20 min-[700px]:pl-[clamp(56px,6.4vw,84px)] min-[700px]:last:after:absolute min-[700px]:last:after:bottom-0 min-[700px]:last:after:left-[17px] min-[700px]:last:after:top-6 min-[700px]:last:after:w-1.5 min-[700px]:last:after:bg-surface min-[700px]:last:after:content-['']"
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 z-[1] flex size-9 items-center justify-center rounded-full border-2 bg-surface font-display text-[16px] font-semibold max-[699px]:-top-0.5 min-[700px]:top-[calc(clamp(30px,3.3vw,44px)*.54-20px)] min-[700px]:size-10 min-[700px]:text-[18px] ${s.node}`}
                >
                  {i + 1}
                </span>
                <div className="grid items-start gap-x-16 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(400px,100%),1fr))]">
                  <div className="flex min-w-0 flex-col gap-4">
                    <h2 className={`${SITE.h2} max-[699px]:min-h-8 max-[699px]:pl-12`}>{s.title}</h2>
                    <p className={SITE.lead}>{s.lead}</p>
                    <p className={`${SITE.soft} text-[16px]`}>{s.detail}</p>
                  </div>
                  {s.picture}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="What happens with the second document" className={SITE.band}>
        <div className={`${SITE.wrap} grid items-center gap-x-20 gap-y-12 [grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr))]`}>
          <SecondDocumentPicture />
          <div className="flex flex-col gap-5">
            <h2 className={SITE.h2}>The second document is easier.</h2>
            <p className={SITE.lead}>
              We remember where each sender puts each value, so the next document from them needs less checking.
            </p>
            <Ticks
              items={[
                `Every flow starts in ${REVIEW_BEFORE_DELIVERY_LABEL}. Each document waits for you, and nothing goes out until you press Send.`,
                "The flow tells you how many documents in a row went out without a correction.",
                `When you trust it, switch that flow to ${AUTOMATIC_DELIVERY_LABEL}. You can switch back at any time.`,
                "A document with a number we have already received always waits for you, so nothing is sent twice.",
                "The first document from a new email address waits for you too. Send it once and later documents from that address go by themselves.",
              ]}
            />
          </div>
        </div>
      </section>

      <section id="pipeline" aria-label="The pipeline, for technical readers" className={`${SITE.band} ${JUMP} on-navy bg-navy text-navy-text`}>
        <div className={`${SITE.wrap} flex flex-col gap-12`}>
          <div className="flex max-w-[720px] flex-col gap-[18px]">
            <h2 className={`${SITE.h2} text-white`}>For technical readers: the pipeline.</h2>
            <p className="text-[20px] leading-[1.5] text-navy-text">
              Every document goes through the same five stages. What happened at each one is kept on the document, so you
              can open it later and read its history.
            </p>
          </div>
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-1.5 hidden h-0.5 rounded-[1px] bg-[linear-gradient(90deg,var(--brand-blue-bright),var(--brand-green-bright))] min-[1060px]:block"
            />
            <ol className="relative m-0 grid list-none gap-x-6 p-0 min-[1060px]:grid-cols-5 min-[1060px]:gap-y-9">
              {STAGES.map((stage) => (
                <li
                  key={stage}
                  className="relative flex flex-col gap-2 pb-7 pl-8 before:absolute before:-bottom-0.5 before:left-1.5 before:top-6 before:w-0.5 before:rounded-[1px] before:bg-navy-border before:content-[''] last:pb-0 last:before:hidden min-[1060px]:p-0 min-[1060px]:before:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1.5 size-3.5 rounded-full border-[3px] bg-navy min-[1060px]:static min-[1060px]:mb-2.5 ${PIPELINE[stage].dot}`}
                  />
                  <h3 className={`${SITE.h3} text-white`}>{stage}</h3>
                  <p className="text-[15.5px]">{PIPELINE[stage].body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap gap-x-7 gap-y-2">
            <Link href="/help/api-reference" className={SITE.onNavyLink}>API reference</Link>
            <Link href="/formats" className={SITE.onNavyLink}>Every format and method</Link>
            <Link href="/security" className={SITE.onNavyLink}>Security</Link>
          </div>
        </div>
      </section>

      <ClosingCta />
    </div>
  );
}
