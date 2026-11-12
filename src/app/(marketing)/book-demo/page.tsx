import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { BookDemoForm } from "@/components/marketing/BookDemoForm";
import { Card } from "@/components/bridge/layout/Card";

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
    "Bring a PDF, Excel or CSV file you handle by hand — or a test or anonymised one. We can run it through ProcuLink while we talk.",
  ],
  [
    "Whether it fits",
    "If a document you handle again and again looks like a good test case, we'll talk through how ProcuLink would handle it. No obligation either way.",
  ],
];

export default function BookDemoPage() {
  return (
    <div className="plk-call">
      <style>{CALL_CSS}</style>
      <span className="plk-call-badge">
        <span className="plk-call-badge-dot" aria-hidden />
        20-minute call
      </span>
      <h1 className="plk-call-h1">Show us one of your documents</h1>
      <p className="plk-call-intro">
        A short call to look at one document you handle by hand — a purchase order, an invoice,
        a price list. Tell us a little about the documents you handle today and we&apos;ll reply
        within 1 business day to find a time.
      </p>

      <Card style={{ marginBottom: 28 }}>
        <h2 className="plk-call-h2">What we&apos;ll cover</h2>
        <ul className="plk-call-list">
          {COVER.map(([title, detail]) => (
            <li key={title}>
              <strong>{title}</strong> — {detail}
            </li>
          ))}
        </ul>
      </Card>

      <BookDemoForm />

      <p className="plk-call-aside">
        Already know you want to test it?{" "}
        <Link href="/sign-up" className="plk-call-link">
          Start your free trial <span aria-hidden>→</span>
        </Link>
      </p>
    </div>
  );
}

// Tokens only. This page used to carry 7 raw hex literals; the design-token ledger
// (scripts/token-debt-baseline.json) loses its row for this file with this change.
const CALL_CSS = `
.plk-call { max-width: 720px; margin: 0 auto; padding: 56px 32px 80px; }
.plk-call-badge {
  display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px; border-radius: 13px;
  background: var(--brand-blue-soft); color: var(--brand-blue-deep);
  font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 16px;
}
.plk-call-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-blue); display: inline-block; }
.plk-call-h1 { font-family: var(--font-display); font-size: clamp(28px, 4vw, 40px); font-weight: 700; letter-spacing: -0.025em; color: var(--ink); margin: 0 0 10px; }
.plk-call-intro { font-size: 15.5px; line-height: 1.7; color: var(--ink-muted); margin: 0 0 28px; max-width: 560px; }
.plk-call-h2 { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--ink); margin: 0 0 10px; }
.plk-call-list { padding-left: 20px; margin: 0; }
.plk-call-list li { font-size: 14px; line-height: 1.7; color: var(--ink-muted); margin-bottom: 6px; }
.plk-call-list li strong { color: var(--ink); }
.plk-call-aside { font-size: 14px; color: var(--ink-muted); margin: 18px 0 0; }
.plk-call-link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; color: var(--brand-blue-deep); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
@media (max-width: 640px) {
  .plk-call { padding: 44px 16px 64px; }
}
`;
