"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { capture } from "@/lib/analytics";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { CheckoutReceipt } from "./checkoutReceipt";

/* This page has TWO referrers and both are load-bearing:
   - Stripe checkout returns every paying customer here with `?upgraded={plan}`
     (success_url is built in the backend, not in this repo), which is why the
     receipt block below is conditional and why the route is noindex and absent
     from the sitemap.
   - It is also the first-order guide for a new workspace.
   Do not delete it, and do not remove the `upgraded` branch.

   ⚠ `upgraded` is a HINT, never the claim. The receipt reads the plan and the
   "active" assertion off `GET /api/billing/status`; see checkoutReceipt.tsx for
   what this page used to assert from the URL alone and why that was a truth
   defect rather than a cosmetic one. */

const S = {
  page: { maxWidth: 680, margin: "0 auto", padding: "72px 32px 80px", textAlign: "center" as const },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: "clamp(30px, 4vw, 44px)",
    fontWeight: 700,
    letterSpacing: "-0.025em",
    color: "var(--ink)",
    margin: "0 0 12px",
  },
  sub: { fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.6, margin: "0 0 36px" },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 28,
    textAlign: "left" as const,
    boxShadow: "var(--shadow-card)",
    marginBottom: 16,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--navy)",
    color: "var(--surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
  },
  stepTitle: { fontSize: 14.5, fontWeight: 600, color: "var(--ink)", margin: 0 },
  stepDesc: { fontSize: 13, color: "var(--ink-muted)", margin: "4px 0 0", lineHeight: 1.55 },
  cta: {
    display: "inline-block",
    background: "var(--navy)",
    color: "var(--surface)",
    textDecoration: "none",
    padding: "12px 22px",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    marginTop: 8,
    minHeight: 44,
  },
};

/* Every step goes somewhere.

   These four were plain <div>s — a printed list a new customer read and then had
   to translate into navigation on their own, on the page they land on straight
   from paying. The steps and the destinations always existed; only the link did
   not. Each row is now the whole tap target, at the 44px floor. */
const STEPS: { n: number; t: string; d: string; href: string }[] = [
  {
    n: 1,
    t: "Add your first supplier",
    d: "Tell us the name of one supplier you currently send orders to.",
    href: "/library/suppliers",
  },
  {
    n: 2,
    t: "Upload a purchase order",
    d: "CSV, XLSX, or PDF. We parse the lines for you.",
    href: "/upload",
  },
  {
    n: 3,
    t: "Confirm field and item mapping",
    d: "Resolve anything we couldn't match automatically.",
    href: "/documents",
  },
  {
    n: 4,
    t: "Send to your supplier",
    d: "Configure SFTP, FTPS, email or HTTP webhook delivery, or download the formatted output.",
    href: "/library/suppliers",
  },
];

function StepRow({ step, last }: { step: (typeof STEPS)[number]; last: boolean }) {
  return (
    <Link
      href={step.href}
      style={{
        display: "flex",
        gap: 14,
        padding: "12px 0",
        borderBottom: last ? "none" : "1px solid var(--border-faint)",
        alignItems: "flex-start",
        textDecoration: "none",
        minHeight: 44,
      }}
    >
      <div style={S.stepNum}>{step.n}</div>
      <div style={{ flex: 1 }}>
        <p style={S.stepTitle}>{step.t}</p>
        <p style={S.stepDesc}>{step.d}</p>
      </div>
      <span aria-hidden style={{ color: "var(--ink-faint)", fontSize: 15, lineHeight: "20px", flexShrink: 0 }}>
        →
      </span>
    </Link>
  );
}

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
      {/* The page carried no mark of the product the customer had just paid for. */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <ProcuLinkMark size={32} />
      </div>

      <h1 style={S.h1}>Welcome to ProcuLink{user?.firstName ? `, ${user.firstName}` : ""}.</h1>
      <p style={S.sub}>
        ProcuLink reads your documents, checks them and sends them on in the format you need. Purchase orders work today. Here&apos;s how to get to your first delivered order.
      </p>

      <CheckoutReceipt
        expectedPlan={upgraded}
        email={user?.primaryEmailAddress?.emailAddress ?? null}
      />

      <div style={S.card}>
        {STEPS.map((s, i) => (
          <StepRow key={s.n} step={s} last={i === STEPS.length - 1} />
        ))}
      </div>

      <Link href="/documents" style={S.cta}>
        Open the dashboard
      </Link>
    </div>
  );
}

export default function WelcomePage() {
  // The (marketing) layout has no QueryClientProvider — only the (app) layout does,
  // and /welcome deliberately sits outside it (a customer returning from Stripe may
  // not have completed org selection yet). The receipt needs a real server read, so
  // this route brings its own client. Same query key as the app's billing query, so
  // nothing is lost when the user walks into /settings next.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <WelcomeBody />
      </Suspense>
    </QueryClientProvider>
  );
}
