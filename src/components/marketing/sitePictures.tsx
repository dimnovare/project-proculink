import Link from "next/link";
import { Check, FileText } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";

// The drawings Home and How it works share. Server-safe: no hooks, no handlers.
// Every word inside a picture is the app's own word for the same thing, and no
// text in a picture is under 12.5px.

export const SITE = {
  wrap: "mx-auto w-full max-w-[1160px] px-6",
  band: "py-16 sm:py-24",
  h2: "font-display text-[clamp(30px,3.3vw,44px)] font-semibold leading-[1.08] tracking-[-0.02em] [text-wrap:balance]",
  lead: "text-[20px] leading-[1.5] text-ink-muted",
  soft: "text-ink-muted",
  more: "inline-flex min-h-[44px] items-center font-semibold text-ink underline decoration-border-strong underline-offset-[5px] hover:text-brand-blue-deep",
  h3: "font-display text-[20px] font-semibold leading-[1.25] tracking-[-0.01em]",
  cta: "inline-flex h-[52px] items-center justify-center rounded-[10px] bg-brand-green-btn px-[26px] text-[17px] font-semibold text-white no-underline hover:bg-brand-green-deep hover:text-white",
} as const;

export const EXAMPLE_INVOICE = {
  supplier: "Example Supplier Ltd",
  street: "12 Harbour Road",
  number: "INV-1001",
  date: "2026-05-20",
  billTo: "Your Company",
  lines: [
    { code: "A-100", item: "Gasket set", qty: 10, price: "50.00", amount: "500.00" },
    { code: "B-200", item: "Valve body", qty: 5, price: "60.00", amount: "300.00" },
    { code: "C-300", item: "Seal kit", qty: 2, price: "100.00", amount: "200.00" },
  ],
  net: "1,000.00",
  vat: "240.00",
  total: "1,240.00",
  totalPlain: "1240.00",
} as const;

const KV = "flex items-center gap-3 border-t border-border-faint px-4 py-[11px] first:border-t-0";

export function Ticks({ items, label, className = "" }: { items: readonly string[]; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={`m-0 flex list-none flex-col gap-2.5 p-0 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <Check aria-hidden="true" className="mt-[3px] size-5 shrink-0 text-brand-green-deep" strokeWidth={2.5} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Tag({ tone, children, className = "" }: { tone: "need" | "ok"; children: React.ReactNode; className?: string }) {
  const colour = tone === "need" ? "bg-amber-soft text-amber-text" : "bg-brand-green-soft text-brand-green-deep";
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold ${colour} ${className}`}>
      {children}
    </span>
  );
}

/** A value marked on the page. The numbered class lets the home example grow each one in turn. */
function Mark({ n, children, block = false }: { n: number; children: React.ReactNode; block?: boolean }) {
  return (
    <span className={`relative ${block ? "block" : "inline-block"}`}>
      <span
        aria-hidden="true"
        className={`plk-ex-hl plk-ex-hl-${n} absolute rounded-[3px] bg-[color-mix(in_srgb,var(--brand-blue)_20%,transparent)] ${
          block ? "-bottom-[3px] -left-1.5 -right-1.5 top-5" : "-inset-x-[5px] -inset-y-px"
        }`}
      />
      {children}
    </span>
  );
}

export function InvoiceSheet({ marked = false, className = "" }: { marked?: boolean; className?: string }) {
  const inv = EXAMPLE_INVOICE;
  const m = (n: number, node: React.ReactNode, block = false) => (marked ? <Mark n={n} block={block}>{node}</Mark> : node);
  const table = (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-2.5 gap-y-1 border-t border-border pt-2 font-mono text-[12.5px]">
      <span className={SITE.soft}>Code</span>
      <span className={SITE.soft}>Item</span>
      <span className={`${SITE.soft} text-right`}>Qty</span>
      <span className={`${SITE.soft} text-right`}>Price</span>
      <span className={`${SITE.soft} text-right`}>Amount</span>
      {inv.lines.flatMap((l) => [
        <span key={`${l.code}-c`}>{l.code}</span>,
        <span key={`${l.code}-i`} className="truncate">{l.item}</span>,
        <span key={`${l.code}-q`} className="text-right">{l.qty}</span>,
        <span key={`${l.code}-p`} className="text-right">{l.price}</span>,
        <span key={`${l.code}-a`} className="text-right">{l.amount}</span>,
      ])}
    </div>
  );
  return (
    <div className={`flex flex-col gap-4 rounded-[5px] bg-surface px-6 py-[26px] text-[12.5px] leading-[1.5] text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--navy)_10%,transparent),0_18px_40px_-18px_color-mix(in_srgb,var(--navy)_28%,transparent)] ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-bold">{m(3, inv.supplier)}</p>
          <p className={SITE.soft}>{inv.street}</p>
        </div>
        <p className="text-[17px] font-bold tracking-[0.08em]">INVOICE</p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div><p className={SITE.soft}>Invoice no</p><p className="font-semibold">{m(1, inv.number)}</p></div>
        <div><p className={SITE.soft}>Date</p><p className="font-semibold">{m(2, inv.date)}</p></div>
        <div><p className={SITE.soft}>Bill to</p><p className="font-semibold">{inv.billTo}</p></div>
      </div>
      {m(5, table, true)}
      <div className="flex flex-col items-end gap-[3px] border-t border-border pt-2.5">
        <p className={SITE.soft}>Net {inv.net}{"   "}VAT {inv.vat}</p>
        <p className="text-[14px] font-bold">Total EUR{"  "}{m(4, inv.total)}</p>
      </div>
    </div>
  );
}

const CSV_LINES = [
  "invoice_no,date,code,qty,price",
  ...EXAMPLE_INVOICE.lines.map((l) => `${EXAMPLE_INVOICE.number},${EXAMPLE_INVOICE.date},${l.code},${l.qty},${l.price}`),
];

/** `head` is drawn inside the card above the file (How it works puts the output chips there). */
export function CsvFile({ sent = false, head }: { sent?: boolean; head?: React.ReactNode }) {
  return (
    <Card flush className="overflow-hidden">
      {head}
      <div className="flex items-center gap-2.5 bg-brand-green-soft px-4 py-3 text-[14px] font-semibold text-brand-green-deep">
        <FileText aria-hidden="true" className="size-[18px] shrink-0" />
        invoice-{EXAMPLE_INVOICE.number}.csv
      </div>
      <div className="overflow-hidden whitespace-nowrap px-4 py-3.5 font-mono text-[12.5px] leading-[1.75] text-ink-muted">
        {CSV_LINES.map((line) => (
          <div key={line} className="plk-ex-line">{line}</div>
        ))}
      </div>
      {sent &&
        ["Accounting server", "Google Sheets"].map((to, i) => (
          <div key={to} className={`${KV} text-[14.5px]`}>
            <span className="flex-1 font-semibold">{to}</span>
            <Tag tone="ok" className={`plk-ex-sent plk-ex-sent-${i + 1}`}>
              <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
              Sent
            </Tag>
          </div>
        ))}
    </Card>
  );
}

const SENDER_DOCS = [
  { name: "invoice-1001.pdf", sub: "First document from this sender. You fixed one value and pointed at another on the page.", tag: "2 values to check", tone: "need" },
  { name: "invoice-1002.pdf", sub: "Same sender, a week later.", tag: "Ready to send", tone: "ok" },
  { name: "invoice-1003.pdf", sub: "And the one after.", tag: "Ready to send", tone: "ok" },
] as const;

export function SecondDocumentPicture() {
  return (
    <Card
      flush
      role="img"
      aria-label="Three documents from the same sender. The first had two values to check. The next two had nothing to check."
      className="overflow-hidden text-[15px]"
    >
      <div aria-hidden="true">
        {SENDER_DOCS.map((d) => (
          <div key={d.name} className={`${KV} flex-wrap gap-x-3 gap-y-2 px-5 py-4`}>
            <div className="min-w-0 flex-[1_1_230px]">
              <p className="font-semibold">{d.name}</p>
              <p className={`${SITE.soft} text-[14px]`}>{d.sub}</p>
            </div>
            <Tag tone={d.tone}>{d.tag}</Tag>
          </div>
        ))}
        <p className="bg-brand-green-soft px-5 py-4 text-[14.5px] text-brand-green-deep">
          The last 8 documents were sent without a correction.
        </p>
      </div>
    </Card>
  );
}

const PAGE_BAR = "h-1.5 rounded-[3px] bg-border";

export function ReviewPicture({ teach = false }: { teach?: boolean }) {
  return (
    <Card
      flush
      role="img"
      aria-label={
        teach
          ? "The review screen. A box is drawn around the total on the original, and a note says we will look there next time."
          : "The review screen: the original document on the left, the values read from it on the right, one value marked to check, and a Send button."
      }
      className="overflow-hidden text-[14.5px]"
    >
      <div aria-hidden="true">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-3.5">
          <p className="flex-[1_1_160px] font-semibold">invoice-1001.pdf</p>
          <Tag tone="need">1 value to check</Tag>
        </div>
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr))]">
          <div className="bg-border-faint p-[18px]">
            <div className="flex flex-col gap-[9px] rounded-[5px] bg-surface p-4 shadow-[0_1px_2px_color-mix(in_srgb,var(--navy)_10%,transparent)]">
              <div className="h-2 w-[46%] rounded bg-border-strong" />
              <div className={`${PAGE_BAR} w-[70%]`} />
              <div className={`${PAGE_BAR} w-[58%]`} />
              <div className={`${PAGE_BAR} mt-2 w-[82%]`} />
              <div className={`${PAGE_BAR} w-[82%]`} />
              {teach ? (
                <div className="relative mt-7 w-[56%] self-end">
                  <span className="absolute bottom-full left-0 rounded-t-[3px] bg-brand-blue px-1.5 text-[12.5px] font-semibold leading-[1.5] text-white">
                    Total
                  </span>
                  <div className="flex h-7 items-center justify-end rounded-[3px] rounded-tl-none border-2 border-dashed border-brand-blue bg-brand-blue-soft px-1.5">
                    <span className="font-mono text-[12.5px] font-medium">{EXAMPLE_INVOICE.total}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`${PAGE_BAR} w-[82%]`} />
                  <div className="mt-2 h-[18px] w-[44%] self-end rounded-[3px] border-2 border-amber bg-amber-soft" />
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 px-[18px] py-4">
            <div>
              <p className={`${SITE.soft} text-[12.5px]`}>Invoice number</p>
              <p className="font-semibold">{EXAMPLE_INVOICE.number}</p>
            </div>
            {!teach && (
              <div>
                <p className={`${SITE.soft} text-[12.5px]`}>Supplier</p>
                <p className="font-semibold">{EXAMPLE_INVOICE.supplier}</p>
              </div>
            )}
            <div className="rounded-lg border-2 border-amber bg-amber-wash px-2.5 py-2">
              <p className="text-[12.5px] font-semibold text-amber-text">Total, check this one</p>
              <p className="font-semibold">{EXAMPLE_INVOICE.totalPlain}</p>
            </div>
            {teach && <p className="text-[13.5px] font-semibold text-brand-blue-deep">Point to it</p>}
          </div>
        </div>
        {teach ? (
          <div className="flex items-start gap-2.5 bg-brand-green-soft px-[18px] py-3 text-[14px] text-brand-green-deep">
            <Check aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" strokeWidth={2.5} />
            <p>Saved. Next time a document from {EXAMPLE_INVOICE.supplier} comes in, we&apos;ll look there for Total.</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-t border-border px-[18px] py-3">
            <p className={`${SITE.soft} flex-1 text-[14px]`}>Invoice CSV to Accounting server</p>
            <span className="inline-flex h-10 items-center rounded-lg bg-brand-green-btn px-[18px] font-semibold text-white">Send</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="bg-surface py-20 sm:py-[104px]">
      <div className={`${SITE.wrap} flex flex-col items-start gap-6`}>
        <h2 id="closing-title" className={`${SITE.h2} !text-[clamp(34px,4.4vw,60px)]`}>Try it on your own documents</h2>
        <p className={`${SITE.lead} max-w-[620px]`}>
          Upload one and see what comes back. It takes a few minutes, and nothing is sent on until you say so.
        </p>
        <div className="flex w-full flex-col gap-x-7 gap-y-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <Link href="/sign-up" className={SITE.cta}>Start your free trial</Link>
          <Link href="/book-demo" className={`${SITE.more} self-center sm:self-auto`}>Talk to us</Link>
        </div>
      </div>
    </section>
  );
}
