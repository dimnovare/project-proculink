import { MarketingNav } from "@/components/marketing/MarketingNav";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { SkipToContent } from "@/components/a11y/SkipToContent";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";

// "One-page overview" is /one-pager — the print-friendly summary of the whole
// offer (what it does, how an order moves through it, the full plan ladder,
// security, contact). It was published in sitemap.ts and linked from nowhere,
// so the only people who ever saw it were the ones handed the URL. It belongs
// in Product rather than on /pricing or /customers because it is not about
// either one on its own, and the footer puts it under both.
const FOOTER_COLS: { h: string; links: [string, string][] }[] = [
  { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["One-page overview", "/one-pager"], ["Open the dashboard", "/bridge"]] },
  { h: "Company", links: [["Customers", "/customers"], ["Book a demo", "/book-demo"], ["Changelog", "/changelog"], ["Help center", "/help"], ["Support", "/support"]] },
  { h: "Legal",   links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["AUP", "/aup"], ["DPA", "/dpa"], ["Subprocessors", "/subprocessors"]] },
];

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#FFFFFF",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <SkipToContent />
      <MarketingNav />
      <main id="main-content" tabIndex={-1} className="outline-none">{children}</main>

      {/* Multi-column navy footer */}
      <footer style={{ background: "#0B1A2F", color: "#9DB2CE" }}>
        <div className="mx-auto max-w-[1100px] px-6 sm:px-8" style={{ padding: "48px 24px 0" }}>
          <div className="grid gap-10 grid-cols-2 sm:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div>
              <a href="/" className="inline-flex items-center gap-2.5" style={{ color: "#FFFFFF", fontWeight: 700, fontSize: 17, textDecoration: "none" }}>
                <ProcuLinkMark size={24} mono /> ProcuLink
              </a>
              <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 300, marginTop: 14 }}>
                The missing link between buyers and suppliers. Turn any purchase order into the exact
                format your supplier needs — with a full audit trail on every order.
              </p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.h}>
                {/* Footer column labels are nav-group headings, not part of the
                    document outline — render as <p> so they don't create an
                    h1→h4 heading-order jump (a11y). Visual is unchanged. */}
                <p style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</p>
                {/* Links stacked as ≥44px-tall flex rows so each is a full touch
                    target (WCAG 2.5.8). The container gap is dropped since the row
                    height now supplies the spacing — visible text is unchanged. */}
                <div className="flex flex-col">
                  {col.links.map(([label, href]) => (
                    <a key={label} href={href} className="flex items-center min-h-[44px]" style={{ color: "#9DB2CE", fontSize: 13, textDecoration: "none" }}>{label}</a>
                  ))}
                  {col.h === "Company" && process.env.NEXT_PUBLIC_STATUS_URL && (
                    <a href={process.env.NEXT_PUBLIC_STATUS_URL} target="_blank" rel="noopener noreferrer" className="flex items-center min-h-[44px]" style={{ color: "#9DB2CE", fontSize: 13, textDecoration: "none" }}>Status</a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-3 mt-12"
            style={{ borderTop: "1px solid #1B2D49", padding: "18px 0 28px", fontSize: 12 }}
          >
            <span>{COPYRIGHT_NOTICE}</span>
            <span className="flex items-center gap-3">
              <a href="/security" style={{ color: "inherit", textDecoration: "none" }}>EU-region order storage</a><span>·</span><span>AES-GCM at rest</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
