import { Suspense } from "react";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/ContactForm";

export const metadata = pageMetadata({
  path: "/support",
  title: "Support — ProcuLink",
  description:
    "Get help with ProcuLink: answers on billing and plans, data and privacy, and legal — plus how to report a problem and what to include so we can reproduce it.",
  ogDescription:
    "Answers on billing, data and privacy, and legal — plus how to report a problem to the ProcuLink team.",
});

const S = {
  page:   { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1:     { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  intro:  { fontSize: 15.5, lineHeight: 1.7, color: "#56627A", marginBottom: 44 },
  h2:     { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 600, color: "#0B1A2F", margin: "36px 0 10px", letterSpacing: "-0.012em" },
  p:      { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 14 },
  li:     { fontSize: 14.5, lineHeight: 1.75, color: "#3D4A5C", marginBottom: 8 },
  card:   {
    background: "#F6F7FA",
    border: "1px solid #E2E6EE",
    borderLeft: "3px solid #2E8E3A",
    borderRadius: 8,
    padding: "20px 22px",
    marginBottom: 12,
  },
};

export default function SupportPage() {
  return (
    <div style={S.page}>
      <h1 style={S.h1}>Support</h1>
      <p style={S.intro}>
        Need help with ProcuLink? Here&apos;s how to reach us and find answers.
      </p>

      {/* Contact card */}
      <div style={S.card}>
        <div
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: "#0B1A2F",
            marginBottom: 8,
          }}
        >
          Email support
        </div>
        <p style={{ ...S.p, marginBottom: 4 }}>
          <a href="mailto:support@proculink.eu" style={{ color: "#1E6D29", fontWeight: 500 }}>
            support@proculink.eu
          </a>
        </p>
        <p style={{ ...S.p, marginBottom: 0, fontSize: 13, color: "var(--ink-faint)" }}>
          Monday – Friday, 9am – 6pm EET. We aim to respond within one business day.
        </p>
      </div>

      <h2 style={S.h2}>Common questions</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
        <li style={S.li}>
          <strong>Billing and plans</strong> — For questions about your subscription, invoices, or
          upgrading your plan, visit the{" "}
          <Link href="/pricing" style={{ color: "#1E6D29", textDecoration: "underline" }}>Pricing page</Link> or email{" "}
          <a href="mailto:support@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>support@proculink.eu</a>.
        </li>
        <li style={S.li}>
          <strong>Data and privacy</strong> — For questions about how we handle your data, see
          our{" "}
          <Link href="/privacy" style={{ color: "#1E6D29", textDecoration: "underline" }}>Privacy Policy</Link>.
        </li>
        <li style={S.li}>
          <strong>Security</strong> — For questions about how ProcuLink is secured, see
          our{" "}
          <Link href="/security" style={{ color: "#1E6D29", textDecoration: "underline" }}>Security page</Link>.
        </li>
        <li style={S.li}>
          <strong>Terms and legal</strong> — See our{" "}
          <Link href="/terms" style={{ color: "#1E6D29", textDecoration: "underline" }}>Terms of Service</Link>.
        </li>
      </ul>

      <h2 style={S.h2} id="report-a-bug">Report a problem</h2>
      <p style={S.p}>
        Found a bug or unexpected behaviour? Email{" "}
        <a href="mailto:support@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>support@proculink.eu</a>{" "}
        and include:
      </p>
      <ul style={{ paddingLeft: 20, marginBottom: 14 }}>
        <li style={S.li}>What you were trying to do</li>
        <li style={S.li}>What happened instead</li>
        <li style={S.li}>Your browser and operating system (if relevant)</li>
        <li style={S.li}>Any error messages you saw</li>
      </ul>
      <p style={S.p}>
        The more detail you give us, the faster we can help.
      </p>

      <h2 style={S.h2}>Security issues</h2>
      <p style={S.p}>
        To report a security vulnerability, please email{" "}
        <a href="mailto:security@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>security@proculink.eu</a>{" "}
        directly. Do not report security issues in public forums. See our{" "}
        <Link href="/security" style={{ color: "#1E6D29", textDecoration: "underline" }}>Security page</Link> for our
        responsible disclosure policy.
      </p>

      <h2 style={S.h2}>Enterprise and partnerships</h2>
      <p style={S.p}>
        For enterprise pricing, custom integrations, or partnership enquiries, email{" "}
        <a href="mailto:hello@proculink.eu" style={{ color: "#1E6D29", textDecoration: "underline" }}>hello@proculink.eu</a>.
      </p>

      {/* ContactForm prefills its subject from ?order= / ?problem= (the "Get help
          with this order" link on a stuck order), which means it reads
          useSearchParams. This boundary is REQUIRED, not decorative: without it
          `next build` fails outright with "useSearchParams() should be wrapped in a
          suspense boundary at page /support". It also confines the client render to
          the form — every answer above it stays in the prerendered HTML. */}
      <Suspense fallback={null}>
        <ContactForm />
      </Suspense>
    </div>
  );
}
