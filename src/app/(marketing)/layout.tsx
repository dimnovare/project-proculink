import { MarketingNav } from "@/components/marketing/MarketingNav";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";

const FOOTER_COLS: { h: string; links: [string, string][] }[] = [
  { h: "Product", links: [["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Security", "/security"], ["Open the dashboard", "/bridge"]] },
  { h: "Company", links: [["Customers", "/customers"], ["Changelog", "/changelog"], ["Help center", "/help"], ["Support", "/support"]] },
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
      <MarketingNav />
      <main>{children}</main>

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
                format your supplier needs — with a full audit trail.
              </p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.h}>
                <h4 style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{col.h}</h4>
                <div className="flex flex-col gap-2.5">
                  {col.links.map(([label, href]) => (
                    <a key={label} href={href} style={{ color: "#9DB2CE", fontSize: 13, textDecoration: "none" }}>{label}</a>
                  ))}
                  {col.h === "Company" && process.env.NEXT_PUBLIC_STATUS_URL && (
                    <a href={process.env.NEXT_PUBLIC_STATUS_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#9DB2CE", fontSize: 13, textDecoration: "none" }}>Status</a>
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
              <span>EU data residency</span><span>·</span><span>AES-GCM at rest</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
