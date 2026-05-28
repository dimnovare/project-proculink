import { MarketingNav } from "@/components/marketing/MarketingNav";

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

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid #E2E6EE",
          background: "#F6F7FA",
          padding: "40px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 14,
            fontWeight: 700,
            color: "#0B1A2F",
          }}
        >
          ProcuLink
        </span>
        <div
          style={{
            display: "flex",
            gap: 24,
            fontSize: 12.5,
            color: "#8A93A5",
            flexWrap: "wrap",
          }}
        >
          <a href="/pricing" style={{ color: "inherit" }}>Pricing</a>
          <a href="/how-it-works" style={{ color: "inherit" }}>How it works</a>
          <a href="/sign-in" style={{ color: "inherit" }}>Sign in</a>
          <span style={{ color: "#D0D5DE" }}>·</span>
          <a href="/privacy" style={{ color: "inherit" }}>Privacy</a>
          <a href="/terms" style={{ color: "inherit" }}>Terms</a>
          <a href="/security" style={{ color: "inherit" }}>Security</a>
          <a href="/support" style={{ color: "inherit" }}>Support</a>
        </div>
        <span style={{ fontSize: 12, color: "#8A93A5" }}>
          © 2026 ProcuLink OÜ
        </span>
      </footer>
    </div>
  );
}
