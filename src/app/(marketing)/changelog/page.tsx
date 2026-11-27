import { ChevronRight } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { ClosingCta, SITE } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";
import { EARLY_ACCESS } from "@/lib/marketing/earlyAccess";

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
// **Name** marks a name on screen (a button, page or tab); it is drawn bold. Marking
// one is formatting, not a rewrite: the words stay as they were.
const ENTRIES = [
  {
    version: "v2.19",
    date: "27 November 2026",
    items: [
      "The German, French, Polish and Estonian text on the website, **Pricing** and the app's menus was reviewed on the screens where it appears and reworded where it read as a word-for-word translation.",
      "Buttons on the website and the sign-up page are now navy, like the app's. The button in the dark top bar is white. Green is kept for sending.",
      "The **Terms** have new sections on indemnities, on your data when the agreement ends, and on force majeure. They now say how long confidentiality lasts and what an overdue payment pauses. Both the **Terms** and the **Privacy Policy** say that their short summary is not part of them, and the **Privacy Policy** gives 14 days' notice of a material change. The changes to the Terms take effect on 14 December 2026.",
    ],
  },
  {
    version: "v2.18",
    date: "27 November 2026",
    items: [
      "The website, **Pricing** and the app's menus can now be read in German, French, Polish and Estonian. Choose a language from the globe button at the top of the site, the footer, or **Language** in your account menu. The legal pages stay in English, which is the binding version.",
      "Invoice pages ProcuLink draws for ZUGFeRD and Factur-X, and the default message of an email destination, are now in the document's language: German, French, Polish or Estonian from the seller's country, otherwise English. Dates and amounts on the page follow that language. An email destination can set it under **More options**, in **Language of the default message**.",
      "A CSV or spreadsheet that writes numbers the European way, such as 1.234,56, is now read correctly. Each document's clear numbers decide its decimal mark. A value that could be read two ways, such as 1.500 in a document with nothing to decide it, is marked for you to check instead of guessed.",
      "The line under **Documents** now counts what **finished** this week, including documents you downloaded instead of sending.",
      "**See why** after a failed test send opens that test in **History**, with the reason and a link to fix the destination.",
      "The main button on each screen is navy. Green is kept for buttons that send a document out, such as **Send** and **Send again**.",
      "A pass on phones, tablets and large screens: grids no longer leave one card alone on a row, wide tables fit at laptop width, and on a phone the buttons in **Settings › Destinations** sit under each destination so addresses no longer break mid-word.",
      "The **Terms** and **Privacy** pages now open with a short summary and have numbered sections, including new ones on accounts and users, confidentiality, who receives your data and how we protect it.",
    ],
  },
  {
    version: "v2.17",
    date: "27 November 2026",
    items: [
      "Once a document is sent, **What we sent** lists only the files that went out. A file added to the flow later no longer shows there, and there is no **Preview** of a file that may have changed since.",
      "**Documents** no longer ends with \"That is everything that needs you\" while documents wait under **Problems**: it says how many are there. The line under the title now counts what was **sent** this week.",
      "When a document couldn't be sent, the reason now sits at the top of the document on every screen size, not only on a phone.",
      "After a document is read, the trial's document count on **Upload** updates without a reload.",
      "**See why** on a destination whose last document couldn't be sent opens **Problems**, where that document is.",
      "In Settings, the Destinations tab now says where your Microsoft accounts are listed. On a phone, the account button on Settings is labelled **Account**.",
    ],
  },
  {
    version: "v2.16",
    date: "26 November 2026",
    items: [
      "When one of a flow's files can't be made, the document now names the file and what it needs, with **Change the file** beside it. If the standard needs a value your documents don't have yet, **Add it as a field** adds it to the flow.",
      "A send that failed and will be tried again is now shown in amber with **Will try again automatically**. Red is kept for sends that stopped. A reference number that comes back from a send has a **Copy** button.",
      "The destination form puts each error under its own box and takes you to the first one.",
      "A trial that has used all its documents can still send them until its last day. New documents wait until you choose a plan.",
    ],
  },
  {
    version: "v2.15",
    date: "26 November 2026",
    items: [
      "**Early access: KSeF and Peppol.** You can ask us to switch on KSeF (Poland), or Peppol and e-invoicing in France through your own B2Brouter account. Both are built and tested in each provider's test environment, and we set up the first send with you. You are the issuer of each invoice.",
      "The Terms and the Privacy Policy now cover e-invoicing providers and the AI assistants you connect. The changes to the Terms take effect on 14 December 2026.",
    ],
  },
  {
    version: "v2.14",
    date: "26 November 2026",
    items: [
      "Connect Claude, ChatGPT, Cursor or VS Code to your workspace: sign in from the assistant, or create a key in **Settings** under **For developers**. Your assistant can add documents, show what needs you, tell you what we read and send them. A document held for a check is sent from ProcuLink itself. The guide **Use ProcuLink from your AI assistant** shows how.",
      "After signing in, you now land on the page you opened, instead of always on **Documents**.",
    ],
  },
  {
    version: "v2.13",
    date: "25 November 2026",
    items: [
      "Invoices can now go out as ZUGFeRD / Factur-X: a PDF people can read, with the invoice data built in. Press **Change the file** on a flow, then **See the standards**. Credit notes come later.",
    ],
  },
  {
    version: "v2.12",
    date: "25 November 2026",
    items: [
      "A flow can now send its file to OneDrive: press **Connect a Microsoft account**, then paste the folder's sharing link into **Folder link**. A file with the same name in that folder is replaced.",
      "ZUGFeRD and Factur-X invoices are read from the invoice data built into the PDF, when the names, numbers and amounts we take from it are also printed on the page. Otherwise the page is read as usual.",
      "**Settings** › **Workspace** now lists the Google and Microsoft accounts your workspace has connected, under **Connected accounts**. **Disconnect** removes one.",
      "Unticking a pickup's **On** box now really switches it off.",
      "In the XML file a flow builds, each table is now named as it is in the flow, the same in every file.",
      "When we couldn't place a table's values in its columns, its heading line no longer merges into a single column.",
    ],
  },
  {
    version: "v2.11",
    date: "24 November 2026",
    items: [
      "On a flow that sends by itself, an emailed document now also waits for you when we couldn't confirm it really came from the address it shows. Sending it doesn't make that address trusted, so the next one from it waits too.",
      "When a document's number was already received, the document says when, and **Open the earlier one** takes you to it.",
      "When one printed label covers several values, such as an address, we name each part: street, city, postcode. A heading printed as several words, like UNIT PRICE, stays one column. Names we make up for unlabelled values are in the document's language.",
      "In the XML file a flow builds from its values, a name that repeats is now numbered, as it already was in CSV and JSON.",
      "A CSV you download from the **Advanced** view now keeps its accented letters in Excel, like every other download.",
      "The three **Start here** guides now show a picture of each step.",
    ],
  },
  {
    version: "v2.10",
    date: "20 November 2026",
    items: [
      "Change the file a flow makes without adding a second one: pick a common type, copy a sample, build it from your system's documentation, or choose a standard. You see the new file first, and nothing changes until you press **Use this file**. Where it goes stays the same.",
      "At the end of your first flow's setup, **Your first file is ready** shows the file, lets you change its type in one tap, and says what happens next.",
      "A flow's page now says in one sentence what the flow does. **Documents** and **History** are buttons under the four steps, and a file's card shows its type, where it goes and its columns.",
      "A ready document on a flow's own **Documents** tab now has its **Make the file** or **Send** button.",
    ],
  },
  {
    version: "v2.9",
    date: "20 November 2026",
    items: [
      "A new flow that an admin creates starts on **Check only what we marked**: a document with a marked value waits for you, and every other one has its file made or is sent straight away. Flows you already have keep their setting.",
      "Every document in a list now shows its next step: **Download**, **Download a copy**, **Review**, **Read it anyway** or **Try again**.",
      "You can remove a document you don't need, from its row, from its own screen, or several at once with **Select**. Once a file has been made or sent from a document, only an admin can remove it. A document we already read still counts toward your plan. A removed document whose file was already made or sent is still recognised if it arrives again.",
      "On a flow whose file you download, the words say so: **Make the file** and **File ready**. The **Documents** tab **Sent** is now **Finished**.",
    ],
  },
  {
    version: "v2.8",
    date: "19 November 2026",
    items: [
      "Phone alerts: turn them on in **Settings**, and your phone tells you when a document needs you or couldn't be sent, with a short summary each day. **Send a test alert** to check it reaches you.",
      "On an iPhone, phone alerts work once ProcuLink is on your home screen.",
    ],
  },
  {
    version: "v2.7",
    date: "18 November 2026",
    items: [
      "Purchase orders sent as cXML, UBL, EDIFACT or X12 now carry every value we read: delivery address and date, both addresses, VAT numbers, and proper unit and country codes.",
    ],
  },
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
      "On Android, an installed ProcuLink is in the **Share** menu: share photos or PDFs from any app, then choose **Add them in ProcuLink**.",
      "On a phone, **Add documents** shows how to send a file by Mail to your workspace's address.",
    ],
  },
  {
    version: "v2.4",
    date: "17 November 2026",
    items: [
      "The phone has four places: **Documents**, **Flows**, the round add button and **Settings**. Your account and **Sign out** are at the top of **Settings**.",
      "**Activity** is now called **History**, with two tabs, **All** and **Changes**, and a way back to **Documents**.",
      "**Documents** says how many are being read, and points once to everything older.",
      "A flow's **Arrives** step starts with your workspace's address. Each flow's own address is one press away.",
      "The first document from a new email address waits for you on a flow that sends automatically.",
    ],
  },
  {
    version: "v2.3",
    date: "16 November 2026",
    items: [
      "Add documents without choosing a flow: drop in anything, or forward it to your workspace's email address, and we work out what it is.",
      "The first time a new kind of document arrives, one screen asks what to do with documents like it.",
      "The top bar has three places: **Documents**, **Flows** and **Settings**. **Lookups** is on **Flows**, and **History** on **Documents**.",
    ],
  },
  {
    version: "v2.2",
    date: "16 November 2026",
    items: [
      "On a flow's **We send** step, each file leads with where it goes and **Send a test**.",
      "**Make another file**: one press of **Create** makes a CSV with every value we read.",
      "Standard formats are listed by family, the ones that fit your documents first.",
      "**We read** shows one **More** for each value, holding its type, its meaning and whether it is required.",
      "Your first flow offers the common places to send a file first, and a server is one press away.",
      "Changes inside a flow say whether they are in use, with **Use these changes** and **Undo my changes**.",
      "**Settings** has three tabs: **Workspace**, **Destinations**, and **Plan & billing**. API keys are under **Workspace**, in **For developers**.",
    ],
  },
  {
    version: "v2.1",
    date: "15 November 2026",
    items: [
      "A new look across the app and the website.",
      "On a phone, the main pages sit in a bar at the bottom of the screen, with a round button to add a document.",
      "**Documents** opens on what needs you, and **Review next** takes you to the next one.",
      "**Activity**: one page for everything that happened to your documents.",
      "**Flows**: each flow says in one sentence what it does, what needs you and its last document.",
      "**Lookups**: import a CSV or Excel file, change values in place, and every change saves as you type, with **Undo**.",
      "The free trial now lasts 30 days.",
      "A long PDF is read ten pages at a time, up to 100 pages.",
      "**Review** saves your changes as you type, marks what needs you in amber, and opens the next document when you send.",
      "**Upload** takes several files at once and shows where each one is.",
      "**Destinations**: test one before you use it, and send a waiting document again with **Send it now**.",
      "A flow's page follows the document: **Arrives**, **We read**, **You check**, **We send**. Changes are a draft until you publish them.",
      "A new workspace starts from a file: add one, see what was read, then choose where it goes.",
      "Search: press Ctrl K to find a document by its name or number.",
      "**Documents**: select several and send or download them together.",
      "**Settings** is one page with tabs for the workspace, destinations, plan and billing, and API keys.",
      "**Help** opens beside your work, with the tasks for the screen you are on.",
      "**Pricing**: choose how many documents you process a month and see which plan costs least.",
      "ProcuLink can be installed like an app from **Settings**. It says when you are offline, and a file you add offline waits until the connection is back.",
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
      {items.map((item, j) => {
        // An early-access item carries its own way to ask (publicCopyDrift.test.ts checks every page that names one).
        const early = item.startsWith(`**${EARLY_ACCESS.heading}`);
        return (
          <li key={j} data-early-access={early ? "" : undefined}>
            {item.split(/\*\*(.+?)\*\*/).map((part, k) => (k % 2 ? <strong key={k}>{part}</strong> : part))}
            {early && <>{" "}<a href={EARLY_ACCESS.cta.href} className="font-semibold underline underline-offset-[3px]">{EARLY_ACCESS.cta.label}</a></>}
          </li>
        );
      })}
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
          <h1 className={SITE.docH1}>
            Changelog
          </h1>
          <p className={`${SITE.lead} max-w-[640px]`}>What&apos;s new in ProcuLink, newest first.</p>
        </div>
      </section>

      <section className="border-b border-border bg-surface pb-10 pt-14">
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