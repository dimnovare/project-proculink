import Link from "next/link";
import { FileSpreadsheet, FileText, FlaskConical, FolderCheck, Inbox, Ruler, type LucideIcon } from "lucide-react";
import { ClosingCta, SITE } from "@/components/marketing/sitePictures";
import { OUTPUT_ROWS, READ_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS, type FormatRow } from "@/components/marketing/formatsRows";
import { MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { EARLY_ACCESS } from "@/lib/marketing/earlyAccess";
import { DOCUMENT_UNIT_SENTENCE } from "@/lib/plans";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/formats",
  title: "Formats: PDF, Excel and scans in. CSV, XML, order standards and e-invoices out — ProcuLink",
  description:
    "Every format and method, in one place. ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
  ogDescription:
    "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
});

// What every workspace has today (offer ⇔ works). The rows come from formatsRows.ts, which a test
// ties to the app's own registries in both directions. The one thing offered only on request
// (SharePoint) says so in its own line. Section heads carry a top rule by direction:
// blue brings in, navy makes real, green sends.

const LIMIT_ROWS: FormatRow[] = [
  { name: "File size", note: `Up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB a file.`, keys: [] },
  { name: "What counts as a document", note: DOCUMENT_UNIT_SENTENCE, keys: [] },
];

const SECTIONS: Array<{ id: string; title: string; lead: string; rule: string; icon: LucideIcon; tone: string; rows: readonly FormatRow[]; note?: string; cta?: { label: string; href: string } }> = [
  {
    id: "read", title: "Documents we read", icon: FileText, rule: "border-t-brand-blue", tone: "text-brand-blue", rows: READ_ROWS,
    lead: "Send the file as it is. We read every value and table on it, and there is no template to build first.",
  },
  {
    id: "outputs", title: "Files we make", icon: FileSpreadsheet, rule: "border-t-brand-green", tone: "text-brand-green-deep", rows: OUTPUT_ROWS,
    lead: "The file your system expects. You choose what goes in it and what each value is called.",
  },
  {
    id: "ways-in", title: "Ways in", icon: Inbox, rule: "border-t-brand-blue", tone: "text-brand-blue", rows: WAYS_IN_ROWS,
    lead: "How a document reaches a flow. The people who send you documents don't need to change anything.",
    note: "Collection runs every five minutes, takes each file once, and leaves it where it is.",
  },
  {
    id: "ways-out", title: "Ways out", icon: FolderCheck, rule: "border-t-brand-green", tone: "text-brand-green-deep", rows: WAYS_OUT_ROWS,
    lead: "Where the finished file goes. One flow can send to several places at once.",
    note: "Microsoft SharePoint: on request",
  },
  {
    id: "early-access", title: EARLY_ACCESS.heading, icon: FlaskConical, rule: "border-t-brand-green", tone: "text-brand-green-deep",
    rows: EARLY_ACCESS.items.map(({ name, note }) => ({ name, note, keys: [] })), lead: EARLY_ACCESS.lead, cta: EARLY_ACCESS.cta,
  },
  {
    id: "limits", title: "Limits", icon: Ruler, rule: "border-t-ink", tone: "text-ink", rows: LIMIT_ROWS,
    lead: "How big a file can be, and how files are counted.",
  },
];

const H2_SMALL = `${SITE.h2} !text-[clamp(27px,2.5vw,34px)]`;

export default function FormatsPage() {
  return (
    <div className="bg-bgWarm text-[17px] leading-[1.55] text-ink">
      <section aria-labelledby="formats-title" className="pb-20 pt-12 sm:pt-[72px]">
        <div className={`${SITE.wrap} flex flex-wrap items-end gap-x-16 gap-y-10`}>
          <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-[26px]">
            <h1 id="formats-title" className={SITE.h1}>Every format and method, in one place</h1>
            <p className={`${SITE.lead} max-w-[680px]`}>
              You don&apos;t need to know the technical format. If it reaches you as a PDF, a spreadsheet, a scan or an email attachment, start with that. The details are here for whoever needs them.
            </p>
          </div>
          <nav aria-label="On this page" className="min-w-0 flex-[1_1_100%] min-[980px]:flex-[0_1_300px]">
            <p className={`${SITE.soft} pb-2.5 text-[15px]`}>On this page</p>
            <ul className="m-0 list-none border-t border-border p-0">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex min-h-[46px] items-center border-b border-border text-[16px] font-semibold text-ink no-underline hover:text-brand-blue-deep">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <div className={`${SITE.band} bg-surface`}>
        <div className={`${SITE.wrap} flex flex-col gap-[clamp(56px,7vw,88px)]`}>
          {SECTIONS.map(({ id, title, lead, rule, icon: Icon, tone, rows, note, cta }) => (
            <section key={id} id={id} aria-labelledby={`${id}-title`} data-early-access={cta ? "" : undefined} className="flex scroll-mt-[90px] flex-wrap items-start gap-x-[72px] gap-y-7">
              <div className={`flex min-w-0 flex-[1_1_280px] flex-col gap-3 border-t-[3px] pt-5 ${rule} min-[900px]:sticky min-[900px]:top-[90px]`}>
                <Icon aria-hidden="true" className={`mb-1 size-9 ${tone}`} strokeWidth={1.6} />
                <h2 id={`${id}-title`} className={H2_SMALL}>{title}</h2>
                <p className={SITE.soft}>{lead}</p>
              </div>
              <div className="min-w-0 flex-[2.3_1_560px]">
                <dl className="m-0 border-b border-border">
                  {rows.map((r) => (
                    <div key={r.name} className="flex flex-wrap gap-x-7 gap-y-0.5 border-t border-border py-4">
                      <dt className="flex-[0_0_240px] font-semibold">{r.name}</dt>
                      <dd className="m-0 flex-[1_1_260px] text-ink-muted">{r.note}</dd>
                    </div>
                  ))}
                </dl>
                {note && <p className={`${SITE.soft} pt-4 text-[15.5px]`}>{note}</p>}
                {cta && <p className="pt-4"><a href={cta.href} className={SITE.more}>{cta.label}</a></p>}
              </div>
            </section>
          ))}
        </div>
      </div>

      <section aria-labelledby="yours-title" className="py-[72px]">
        <div className={`${SITE.wrap} flex flex-wrap items-center gap-x-[72px] gap-y-4`}>
          <h2 id="yours-title" className={`${H2_SMALL} flex-[1_1_280px]`}>Don&apos;t see yours?</h2>
          <div className="flex min-w-0 flex-[2.3_1_560px] flex-col items-start gap-1.5">
            <p className={SITE.lead}>Show us the file or the system on a short call and we&apos;ll tell you plainly whether it fits.</p>
            <Link href="/book-demo" className={SITE.more}>Talk to us</Link>
          </div>
        </div>
      </section>

      <ClosingCta more={{ href: "/how-it-works", label: "See how it works" }} />
    </div>
  );
}
