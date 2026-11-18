import { ChevronRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { ClosingCta, SITE } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/changelog",
  title: "Changelog — ProcuLink",
  description:
    "A record of every improvement shipped to ProcuLink — new features, formats, integrations, and platform changes, newest first.",
  ogDescription:
    "Every improvement shipped to ProcuLink — new features, formats, integrations, and platform changes.",
});

// APPEND-ONLY, newest first. An entry records what was true on its date, so it
// is never edited afterwards — when something is retired or turns out not to
// have worked, that is a NEW entry saying so, not a rewrite of the old one.
// Editing the entry that announced a feature claims it never shipped.
//
// `latest: …` on the entries below is legacy and unread. Position decides:
// index 0 is the newest and the only one tagged Latest, so appending an entry
// cannot leave the previous one badged Latest.
// The old values stay because src/test/changelog-append-only.test.ts freezes
// those entries byte for byte.
const ENTRIES = [
  {
    version: "v2.6",
    date: "18 November 2026",
    items: [
      "A flow that was never put in use can be deleted, with its documents. Press the pencil beside the flow's name.",
    ],
  },
  {
    version: "v2.5",
    date: "17 November 2026",
    items: [
      "On Android, an installed ProcuLink is in the Share menu: share photos or PDFs from any app, then choose Add them in ProcuLink.",
      "On a phone, Add documents shows how to send a file by Mail to your workspace's address.",
    ],
  },
  {
    version: "v2.4",
    date: "17 November 2026",
    items: [
      "The phone has four places: Documents, Flows, the round add button and Settings. Your account and Sign out are at the top of Settings.",
      "Activity is now called History, with two tabs, All and Changes, and a way back to Documents.",
      "Documents says how many are being read, and points once to everything older.",
      "A flow's Arrives step starts with your workspace's address. Each flow's own address is one press away.",
      "The first document from a new email address waits for you on a flow that sends automatically.",
    ],
  },
  {
    version: "v2.3",
    date: "16 November 2026",
    items: [
      "Add documents without choosing a flow: drop in anything, or forward it to your workspace's email address, and we work out what it is.",
      "The first time a new kind of document arrives, one screen asks what to do with documents like it.",
      "The top bar has three places: Documents, Flows and Settings. Lookups is on Flows, and History on Documents.",
    ],
  },
  {
    version: "v2.2",
    date: "16 November 2026",
    items: [
      "On a flow's We send step, each file leads with where it goes and Send a test.",
      "Make another file: one press of Create makes a CSV with every value we read.",
      "Standard formats are listed by family, the ones that fit your documents first.",
      "We read shows one More for each value, holding its type, its meaning and whether it is required.",
      "Your first flow offers the common places to send a file first, and a server is one press away.",
      "Changes inside a flow say whether they are in use, with Use these changes and Undo my changes.",
      "Settings has three tabs: Workspace, Destinations, and Plan & billing. API keys are under Workspace, in For developers.",
    ],
  },
  {
    version: "v2.1",
    date: "15 November 2026",
    items: [
      "A new look across the app and the website.",
      "On a phone, the main pages sit in a bar at the bottom of the screen, with a round button to add a document.",
      "Documents opens on what needs you, and Review next takes you to the next one.",
      "Activity: one page for everything that happened to your documents.",
      "Flows: each flow says in one sentence what it does, what needs you and its last document.",
      "Lookups: import a CSV or Excel file, change values in place, and every change saves as you type, with Undo.",
      "The free trial now lasts 30 days.",
      "A long PDF is read ten pages at a time, up to 100 pages.",
      "Review saves your changes as you type, marks what needs you in amber, and opens the next document when you send.",
      "Upload takes several files at once and shows where each one is.",
      "Destinations: test one before you use it, and send a waiting document again with Send it now.",
      "A flow's page follows the document: Arrives, We read, You check, We send. Changes are a draft until you publish them.",
      "A new workspace starts from a file: add one, see what was read, then choose where it goes.",
      "Search: press Ctrl K to find a document by its name or number.",
      "Documents: select several and send or download them together.",
      "Settings is one page with tabs for the workspace, destinations, plan and billing, and API keys.",
      "Help opens beside your work, with the tasks for the screen you are on.",
      "Pricing: choose how many documents you process a month and see which plan costs least.",
      "ProcuLink can be installed like an app from Settings. It says when you are offline, and a file you add offline waits until the connection is back.",
    ],
  },
  {
    version: "v2.0",
    date: "14 November 2026",
    items: [
      "ProcuLink now reads any document. Set up a flow, check what we read, and send it in the format you need. Your old orders stay readable under Old orders.",
    ],
  },
  {
    version: "v1.6",
    date: "August 2026",
    items: [
      "Tier correction to the v1.4 note below — IMAP email polling, SFTP folder pull and S3/R2 bucket pull are all included on Growth (€149/month) and up, not on a dearer tier. Ingestion channels were decoupled from order volume, so every paid plan carries all three; the v1.4 wording named a tier €850/month above the real minimum. That note stays as written — an entry records what was published on its date — and the plan each channel really needs is the one shown on the formats and pricing pages.",
    ],
  },
  {
    version: "v1.5",
    date: "July 2026",
    items: [
      "Output templates screen retired — saving a template silently discarded the body (the screen posted a field the API never read), and no transform ever consulted a stored template. The format a supplier receives is set on that supplier's delivery configuration, which is where it always came from.",
      "Validation rules screen and the read-only rule catalog retired — they offered create, edit and delete over records that nothing in parsing, transformation or delivery ever evaluated; the drawer's own “Triggered 0 times” counter was accurate. The checks that do run are the per-supplier Validation rules tab, which is unchanged and shows the same standards references inline.",
      "Drafts and Upload preview screens retired — orders cannot be saved as drafts, so Drafts could never hold one, and uploads go straight to the order review screen, which does everything the preview did and more.",
      "Inbound webhook ingress withdrawn from the product copy — it read as a way to send us orders, but it could never be switched on: verifying an inbound POST needs a per-organisation signing secret, and nothing in the product could set one. Orders arrive by upload, by email, or by a POST to the REST endpoint. Outbound webhook subscriptions — we call your URL when an order is created, delivered or fails — are untouched and still live.",
      "Every retired screen answers with a permanent redirect to the screen that does the job, so existing bookmarks, help links and search results keep working.",
    ],
  },
  {
    version: "v1.4",
    date: "May 2026",
    latest: true,
    items: [
      "Production UI polish across all screens — mobile-first responsive layouts, empty states, and interaction feedback",
      "IMAP email polling — Integration+ plans now auto-ingest purchase orders from designated mailboxes",
      "ERP connector adapters for Erply and Directo — deliver POs directly to your ERP",
      "Inbound invoices and advance shipping notices — receive and approve supplier documents in one place",
    ],
  },
  {
    version: "v1.3",
    date: "April 2026",
    latest: false,
    items: [
      "PDF ingestion — text-based PDF purchase orders now accepted alongside CSV and XLSX",
      "AI mapping suggestions — unresolved line items now show AI-suggested supplier codes with confidence scores",
    ],
  },
  {
    version: "v1.2",
    date: "March 2026",
    latest: false,
    items: [
      "Supplier delivery configuration — HTTP delivery with test-fire, encrypted credentials, retry logic",
      "PO field mapping engine — custom per-supplier CSV column mapping with visual editor",
      "Webhooks — register HTTP endpoints to receive real-time delivery events",
    ],
  },
  {
    version: "v1.1",
    date: "February 2026",
    latest: false,
    items: [
      "Stripe billing — Growth, Operations, and Integration plans with self-serve Checkout and Portal",
      "Audit log — full event history for every order",
      "Connectors page — overview of all active delivery channels",
    ],
  },
  {
    version: "v1.0",
    date: "January 2026",
    latest: false,
    items: [
      "Initial release: parse → validate → review → transform → deliver workflow",
      "Supplier library, item mappings, validation rules, output templates",
      "Multi-tenant with Clerk auth, EF Core + Postgres",
    ],
  },
];


type Entry = (typeof ENTRIES)[number];

/** "January to November 2026", or "January 2026 to January 2027" across a year. */
function earlierRange(entries: readonly Entry[]): string {
  const monthYear = (d: string) => d.split(" ").slice(-2);
  const [fromMonth, fromYear] = monthYear(entries[entries.length - 1].date);
  const [toMonth, toYear] = monthYear(entries[0].date);
  return fromYear === toYear ? `${fromMonth} to ${toMonth} ${toYear}` : `${fromMonth} ${fromYear} to ${toMonth} ${toYear}`;
}

function Items({ items, big }: { items: readonly string[]; big?: boolean }) {
  return (
    <ul className={`m-0 flex min-w-0 flex-[1_1_420px] list-disc flex-col gap-3 pl-6 ${big ? "text-[clamp(19px,1.1vw+14.5px,22px)] leading-[1.45]" : ""}`}>
      {items.map((item, j) => (
        <li key={j}>{item}</li>
      ))}
    </ul>
  );
}

export default function ChangelogPage() {
  // ENTRIES is newest-first, so index 0 is the current release.
  const [newest, ...earlier] = ENTRIES;
  return (
    <div className={SITE_PAGE}>
      <section className="pb-12 pt-16">
        <div className={`${SITE.wrap} flex flex-col gap-4`}>
          <h1 className="m-0 font-display text-[clamp(38px,4.2vw,56px)] font-semibold leading-[1.04] tracking-[-0.02em]">
            Changelog
          </h1>
          <p className={`${SITE.lead} max-w-[640px]`}>What&apos;s new in ProcuLink, newest first.</p>
        </div>
      </section>

      <section className="border-b border-border bg-surface pb-24 pt-14">
        <div className={SITE.wrap}>
          <div className="max-w-[920px]">
            <article className="flex flex-wrap gap-x-14 gap-y-4 pb-11 pt-2">
              <div className="flex flex-[0_0_210px] flex-col items-start gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{newest.version}</h2>
                  <span className="inline-flex h-[26px] items-center rounded-full bg-surface-2 px-2.5 text-[13px] font-semibold text-ink">
                    Latest
                  </span>
                </div>
                <time className={`${SITE.soft} text-[16px]`}>{newest.date}</time>
              </div>
              <Items items={newest.items} big />
            </article>

            <details className="group border-y border-border">
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 py-2 text-[18px] font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-[18px] flex-none group-open:rotate-90" strokeWidth={2.4} />
                <span className="min-w-0 flex-1">{`Earlier versions (${earlierRange(earlier)})`}</span>
                <span className={`${SITE.soft} flex-none text-[15px] font-medium`}>{`${earlier.length} versions`}</span>
              </summary>
              {earlier.map((entry) => (
                <article key={entry.version} className="flex flex-wrap gap-x-14 gap-y-3 border-t border-border-faint py-6">
                  <div className="flex flex-[0_0_210px] flex-col items-start gap-1">
                    <h3 className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em]">{entry.version}</h3>
                    <time className={`${SITE.soft} text-[15px]`}>{entry.date}</time>
                  </div>
                  <Items items={entry.items} />
                </article>
              ))}
            </details>
          </div>
        </div>
      </section>

      <ClosingCta />
    </div>
  );
}