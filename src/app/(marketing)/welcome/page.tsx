"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { capture } from "@/lib/analytics";

const S = {
  page:   { maxWidth: 680, margin: "0 auto", padding: "72px 32px 80px", textAlign: "center" as const },
  h1:     { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", margin: "0 0 12px" },
  sub:    { fontSize: 16, color: "#56627A", lineHeight: 1.6, margin: "0 0 36px" },
  card:   { background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: 28, textAlign: "left" as const, boxShadow: "0 4px 14px rgba(11,26,47,0.05)", marginBottom: 16 },
  step:   { display: "flex", gap: 14, padding: "12px 0", borderBottom: "1px solid #F1F3F7", alignItems: "flex-start" },
  stepNum:{ width: 28, height: 28, borderRadius: "50%", background: "#0B1A2F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 },
  stepBody: { flex: 1 },
  stepTitle: { fontSize: 14.5, fontWeight: 600, color: "#0B1A2F", margin: 0 },
  stepDesc:  { fontSize: 13, color: "#56627A", margin: "4px 0 0", lineHeight: 1.55 },
  cta:    { display: "inline-block", background: "#0B1A2F", color: "#fff", textDecoration: "none", padding: "12px 22px", borderRadius: 8, fontWeight: 600, fontSize: 14, marginTop: 8 },
  skip:   { display: "block", marginTop: 16, color: "var(--ink-faint)", fontSize: 13 },
};

function WelcomeBody() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded");

  useEffect(() => {
    if (!isLoaded) return;
    capture("welcome_viewed", { upgraded: upgraded ?? "" });
  }, [isLoaded, upgraded]);

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Welcome to ProcuLink{user?.firstName ? `, ${user.firstName}` : ""}.</h1>
      <p style={S.sub}>
        ProcuLink turns the purchase orders you send out into the exact format each supplier needs, and delivers them automatically. Here&apos;s how to get to your first delivered order.
      </p>

      {upgraded && (
        <div style={{ ...S.card, borderLeft: "3px solid #2E8E3A", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 600, color: "#0B1A2F", margin: "0 0 6px", textAlign: "left" }}>
            You&apos;re on {upgraded.charAt(0).toUpperCase() + upgraded.slice(1)}.
          </h2>
          <p style={{ fontSize: 13.5, color: "#56627A", lineHeight: 1.55, margin: 0, textAlign: "left" }}>
            Your subscription is active. Your billing portal is in <Link href="/settings" style={{ color: "#2E8E3A" }}>Settings → Billing</Link>. Receipt was emailed to {user?.primaryEmailAddress?.emailAddress ?? "your inbox"}.
          </p>
        </div>
      )}

      <div style={S.card}>
        {[
          { n: 1, t: "Add your first supplier", d: "Tell us the name of one supplier you currently send orders to." },
          { n: 2, t: "Upload a purchase order", d: "CSV, XLSX, or PDF. We parse the lines for you." },
          { n: 3, t: "Confirm field and item mapping", d: "Resolve anything we couldn't match automatically." },
          { n: 4, t: "Send to your supplier", d: "Configure HTTP webhook delivery, or download the formatted output." },
        ].map((s) => (
          <div key={s.n} style={S.step}>
            <div style={S.stepNum}>{s.n}</div>
            <div style={S.stepBody}>
              <p style={S.stepTitle}>{s.t}</p>
              <p style={S.stepDesc}>{s.d}</p>
            </div>
          </div>
        ))}
      </div>

      <Link href="/bridge" style={S.cta}>Open the dashboard</Link>
      <Link href="/bridge?onboard=skip" style={S.skip}>Skip the wizard for now</Link>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeBody />
    </Suspense>
  );
}
