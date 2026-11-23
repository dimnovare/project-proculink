import Link from "next/link";
import { SkipToContent } from "@/components/a11y/SkipToContent";
import { HomeExample } from "@/components/marketing/HomeExample";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { ClosingCta, FLOW_SENTENCE, ReviewPicture, SecondDocumentPicture, SITE, Ticks } from "@/components/marketing/sitePictures";
import { LEGAL_ENTITY, REGISTERED_LOCALITY } from "@/lib/legal-entity";
import { PLAN_BY_ID, PUBLIC_LADDER } from "@/lib/plans";
import { SITE_DESCRIPTION } from "@/lib/seo";

// Every number on this page is read off the plan table, never typed.
const TRIAL = PLAN_BY_ID.pilot;
const STARTER = PLAN_BY_ID.starter;
const PRICE_ROW = PUBLIC_LADDER.filter((p) => !p.isCustom);

const COLUMNS = [
  { title: "We read", rule: "border-brand-blue", items: ["PDF", "Excel and CSV", "Word and text", "XML and JSON", "Scans and phone photos"] },
  { title: "You get", rule: "border-navy", items: ["CSV", "Excel", "JSON or XML", "PDF", "Text or fixed-width"] },
  { title: "It goes to", rule: "border-brand-green", items: ["Email", "An SFTP or FTPS server", "Google Drive or Sheets", "An S3 bucket or a web address", "Or a download"] },
];

const STEPS = [
  { title: "You send it in", rule: "border-brand-blue", body: "Upload a file, forward an email, or let us collect it from a mailbox, an SFTP or FTP server, an S3 bucket, or our API." },
  { title: "We read it", rule: "border-brand-blue", body: "We read every value and table on the first document. There's no template to build first. Scans and phone photos are read too." },
  { title: "You check it", rule: "border-amber", body: "The original stays on screen beside what we read. Fix a value, or point at it on the page so we find it next time." },
  { title: "We send it", rule: "border-brand-green", body: "Choose the file your system needs, then send it by email, to a server, to Google Drive or Sheets, or download it." },
];

const TECH = [
  ["An address and an API for every flow", "Email a flow, post a file to it, fetch the result, or have us call your web address when a document is read or sent."],
  ["Pickups every five minutes", "We check a mailbox, an SFTP, FTPS or FTP server, or an S3 bucket every five minutes. Each file is picked up once, and files on a server or in a bucket stay where they are."],
  ["Outputs from your documentation", "Upload your receiving system's documentation or a sample file and we propose the output for you to check."],
  ["Lookups", "Swap a value on the document for the one your system uses, from a list you import."],
  ["Versions you can go back to", "Changes to a flow go live when you publish them, and any earlier version can be restored."],
  ["A record of every delivery", "Each delivery keeps when it went, its channel, how many attempts it took, the destination's answer where it gives one and, when it fails, the error."],
] as const;

const TRUST_LINKS = [
  ["Security", "/security", "Encryption, EU-region document storage and how AI is used"],
  ["Privacy", "/privacy", "What we collect and how long we keep it"],
  ["Data processing addendum", "/dpa", "The contract for the documents you send us"],
  ["Subprocessors", "/subprocessors", "Every company that handles your data, and where"],
] as const;

const API_EXAMPLE = `curl -X POST \\
  https://api.proculink.eu/api/v1/flows/FLOW_ID/documents \\
  -H "X-ProcuLink-Key: YOUR_KEY" \\
  -F "file=@invoice.pdf"`;

const TWO = "grid items-center gap-x-20 gap-y-12 [grid-template-columns:repeat(auto-fit,minmax(min(440px,100%),1fr))]";

export default function RootPage() {
  return (
    <>
      <SkipToContent />
      <MarketingNav />
      <main id="main-content" tabIndex={-1} className="bg-bgWarm text-[17px] leading-[1.55] text-ink outline-none">
        {/* 1. Introduction */}
        <section aria-label="Introduction" className="pb-16 pt-12 sm:pb-24 sm:pt-[72px]">
          <div className={`${SITE.wrap} flex flex-col gap-14`}>
            <div className="flex flex-wrap items-end gap-x-16 gap-y-10">
              <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-[26px]">
                <h1 className={SITE.h1}>
                  <span className="text-brand-blue">Any document in.</span>{" "}
                  <span className="block text-brand-green-deep">Clean data out.</span>
                </h1>
                <p className={`${SITE.lead} max-w-[620px]`}>{SITE_DESCRIPTION}</p>
                <div className="flex flex-col gap-x-7 gap-y-2.5 sm:flex-row sm:flex-wrap sm:items-center">
                  <Link href="/sign-up" className={SITE.cta}>Start your free trial</Link>
                  <p className={`${SITE.soft} text-center text-[15px] sm:order-last sm:basis-full sm:text-left`}>
                    {`Free for ${TRIAL.priceCadence} · ${TRIAL.orderLimit} documents · `}
                    <span className="whitespace-nowrap">{`from €${STARTER.priceMonthly} a month after.`}</span> No card needed.
                  </p>
                  <Link href="/how-it-works" className={`${SITE.more} self-center sm:self-auto`}>See how it works</Link>
                </div>
              </div>
              <Ticks
                label="Good to know"
                className="flex-[0_1_330px] text-[16px]"
                items={[
                  "No integration needed to start",
                  "The people who send you documents change nothing",
                  "Try it with a test or anonymised document",
                  "Anything we're unsure of waits for you",
                ]}
              />
            </div>
            <HomeExample />
          </div>
        </section>

        {/* 2. What you can send and get */}
        <section aria-labelledby="home-formats" className={`${SITE.band} bg-surface`}>
          <div className={`${SITE.wrap} flex flex-wrap items-start gap-x-16 gap-y-12`}>
            <div className="flex flex-[1_1_320px] flex-col gap-5">
              <h2 id="home-formats" className={SITE.h2}>Start with the documents you already get.</h2>
              <p className={SITE.lead}>
                You don&apos;t need to know a technical format or set up an integration. If it reaches you as a PDF, a
                spreadsheet, a scan or an email attachment, start with that.
              </p>
              <Link href="/formats" className={`${SITE.more} self-start`}>Every format and method</Link>
            </div>
            <div className="grid flex-[2.4_1_620px] gap-x-8 gap-y-7 [grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr))]">
              {COLUMNS.map((c) => (
                <div key={c.title} className={`flex flex-col gap-3 border-t-[3px] pt-5 ${c.rule}`}>
                  <h3 className={SITE.h3}>{c.title}</h3>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {c.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ))}
              <p className={`${SITE.soft} col-span-full text-[15px]`}>Microsoft OneDrive and SharePoint on request.</p>
            </div>
          </div>
        </section>

        {/* 3. The second document */}
        <section aria-labelledby="home-second" className={SITE.band}>
          <div className={`${SITE.wrap} ${TWO}`}>
            <SecondDocumentPicture />
            <div className="flex flex-col gap-5">
              <h2 id="home-second" className={SITE.h2}>
                <span className="inline-block">Check it once.</span> <span className="inline-block">The next one is easier.</span>
              </h2>
              <p className={SITE.lead}>
                The first document from a sender is where you help: fix a value, or point at it on the page. We remember
                where that sender puts it, so the next document needs less checking.
              </p>
              <p>
                There is no template to build first. When a flow keeps going through without corrections, you can let it
                send everything by itself.
              </p>
              <p className={SITE.soft}>{FLOW_SENTENCE}</p>
            </div>
          </div>
        </section>

        {/* 4. You decide */}
        <section aria-labelledby="home-decide" className={`${SITE.band} bg-surface`}>
          <div className={`${SITE.wrap} ${TWO}`}>
            <div className="flex flex-col gap-5">
              <h2 id="home-decide" className={SITE.h2}>You decide what waits for you.</h2>
              <p className={SITE.lead}>
                Anything missing or hard to read is marked, and a document with a marked value waits for you, with the
                original beside what we read. Every other document goes straight through, unless you set the flow to
                wait on every one.
              </p>
              <Ticks
                items={[
                  "A document we have already seen always waits, so nothing goes out twice.",
                  "Download the result and send it yourself, for as long as you like.",
                  "Every read, edit and delivery is recorded on the document.",
                ]}
              />
            </div>
            <ReviewPicture />
          </div>
        </section>

        {/* 5. How it works */}
        <section aria-labelledby="home-steps" className={SITE.band}>
          <div className={`${SITE.wrap} flex flex-col gap-11`}>
            <h2 id="home-steps" className={SITE.h2}>How it works</h2>
            <ol className="m-0 grid list-none gap-x-8 gap-y-9 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))]">
              {STEPS.map((s, i) => (
                <li key={s.title} className={`flex flex-col gap-2.5 border-t-[3px] pt-[18px] ${s.rule}`}>
                  <span className={`font-display text-[15px] font-semibold ${SITE.soft}`}>Step {i + 1}</span>
                  <h3 className={SITE.h3}>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 6. For whoever looks after the systems */}
        <section aria-labelledby="home-tech" className={`${SITE.band} on-navy bg-navy text-navy-text`}>
          <div className={`${SITE.wrap} flex flex-col gap-11`}>
            <div className="flex flex-wrap items-start gap-x-16 gap-y-8">
              <div className="flex flex-[1_1_420px] flex-col gap-[18px]">
                <h2 id="home-tech" className={`${SITE.h2} text-white`}>For whoever looks after the systems.</h2>
                <p className="text-[20px] leading-[1.5] text-navy-text">
                  Everything above also runs without anyone clicking. Each flow can take documents in and send results out
                  by itself.
                </p>
              </div>
              <figure aria-label="Example: send a file to a flow over the API" className="m-0 min-w-0 flex-[1_1_420px]">
                <pre tabIndex={0} className="m-0 overflow-x-auto rounded-xl bg-navy-surface px-[22px] py-5 font-mono text-[13px] leading-[1.7] text-navy-text">
                  {API_EXAMPLE}
                </pre>
              </figure>
            </div>
            <div className="grid gap-x-10 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
              {TECH.map(([title, body]) => (
                <div key={title} className="flex flex-col gap-2 border-t border-navy-border pt-[18px]">
                  <h3 className={`${SITE.h3} text-white`}>{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-7 gap-y-2">
              <Link href="/help/api-reference" className={SITE.onNavyLink}>API reference</Link>
              <Link href="/security" className={SITE.onNavyLink}>Security</Link>
            </div>
          </div>
        </section>

        {/* 7. Price */}
        <section aria-labelledby="home-price" className={`${SITE.band} bg-surface`}>
          <div className={`${SITE.wrap} flex flex-col gap-8`}>
            <div className="flex max-w-[720px] flex-col gap-3.5">
              <h2 id="home-price" className={SITE.h2}>One price list. Everything included.</h2>
              <p className={SITE.lead}>
                Every plan has every way in, every output and every check. You pay for the documents you process.
              </p>
            </div>
            <ul
              aria-label="Plans"
              className="m-0 grid list-none border-t border-border p-0 [grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr))]"
            >
              {PRICE_ROW.map((p) => {
                const limit = p.orderLimit?.toLocaleString("en-GB");
                return (
                  <li key={p.id} className="flex flex-col gap-0.5 border-b border-border py-5 pr-5">
                    <h3 className={SITE.h3}>{p.name}</h3>
                    <p className="font-semibold">{p.id === TRIAL.id ? `Free for ${p.priceCadence}` : `€${p.priceMonthly} a month`}</p>
                    <p className={`${SITE.soft} text-[15px]`}>{p.id === TRIAL.id ? `${limit} documents` : `${limit} documents a month`}</p>
                  </li>
                );
              })}
            </ul>
            <Link href="/pricing" className={`${SITE.more} self-start`}>See pricing, and what counts as a document</Link>
          </div>
        </section>

        {/* 8. Who runs ProcuLink */}
        <section aria-labelledby="home-who" className={SITE.band}>
          <div className={`${SITE.wrap} ${TWO} !items-start`}>
            <div className="flex flex-col gap-[18px]">
              <h2 id="home-who" className={SITE.h2}>Who runs ProcuLink</h2>
              <p className={SITE.lead}>
                {`ProcuLink is built and run by ${LEGAL_ENTITY.legalName}, a company registered in ${REGISTERED_LOCALITY.city}, ${REGISTERED_LOCALITY.country}, under registry code ${LEGAL_ENTITY.registryCode}.`}
              </p>
              <p>Support answers Monday to Friday, 9am to 6pm EET, and we aim to reply within one business day.</p>
            </div>
            <div className="border-b border-border-strong">
              {TRUST_LINKS.map(([label, href, line]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-[44px] flex-wrap items-baseline gap-x-4 gap-y-0.5 border-t border-border-strong py-3 text-ink no-underline"
                >
                  <strong className="flex-[0_0_235px] font-semibold">{label}</strong>
                  <span className={`${SITE.soft} flex-[1_1_220px]`}>{line}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 9. Closing */}
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
