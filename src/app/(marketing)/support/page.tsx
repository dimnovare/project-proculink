import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/ContactForm";

export const metadata: Metadata = {
  title: "Support — ProcuLink",
  description: "Get help with ProcuLink procurement automation.",
};

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
          <a href="mailto:support@proculink.eu" style={{ color: "#2E8E3A", fontWeight: 500 }}>
            support@proculink.eu
          </a>
        </p>
        <p style={{ ...S.p, marginBottom: 0, fontSize: 13, color: "#8A93A5" }}>
          Monday – Friday, 9am – 6pm EET. We aim to respond within one business day.
        </p>
      </div>

      <h2 style={S.h2}>Common questions</h2>
      <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
        <li style={S.li}>
          <strong>Billing and plans</strong> — For questions about your subscription, invoices, or
          upgrading your plan, visit the{" "}
          <Link href="/pricing" style={{ color: "#2E8E3A" }}>Pricing page</Link> or email{" "}
          <a href="mailto:support@proculink.eu" style={{ color: "#2E8E3A" }}>support@proculink.eu</a>.
        </li>
        <li style={S.li}>
          <strong>Data and privacy</strong> — For questions about how we handle your data, see
          our{" "}
          <Link href="/privacy" style={{ color: "#2E8E3A" }}>Privacy Policy</Link>.
        </li>
        <li style={S.li}>
          <strong>Security</strong> — For questions about how ProcuLink is secured, see
          our{" "}
          <Link href="/security" style={{ color: "#2E8E3A" }}>Security page</Link>.
        </li>
        <li style={S.li}>
          <strong>Terms and legal</strong> — See our{" "}
          <Link href="/terms" style={{ color: "#2E8E3A" }}>Terms of Service</Link>.
        </li>
      </ul>

      <h2 style={S.h2}>Report a problem</h2>
      <p style={S.p}>
        Found a bug or unexpected behaviour? Email{" "}
        <a href="mailto:support@proculink.eu" style={{ color: "#2E8E3A" }}>support@proculink.eu</a>{" "}
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
        <a href="mailto:security@proculink.eu" style={{ color: "#2E8E3A" }}>security@proculink.eu</a>{" "}
        directly. Do not report security issues in public forums. See our{" "}
        <Link href="/security" style={{ color: "#2E8E3A" }}>Security page</Link> for our
        responsible disclosure policy.
      </p>

      <h2 style={S.h2}>Enterprise and partnerships</h2>
      <p style={S.p}>
        For enterprise pricing, custom integrations, or partnership enquiries, email{" "}
        <a href="mailto:hello@proculink.eu" style={{ color: "#2E8E3A" }}>hello@proculink.eu</a>.
      </p>

      <ContactForm />
    </div>
  );
}
