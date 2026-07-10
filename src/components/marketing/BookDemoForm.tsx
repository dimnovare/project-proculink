"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { friendlySubmitError } from "@/lib/friendly-submit-error";
import { captureException } from "@/lib/sentry-context";

// Same visual grammar as ContactForm (src/components/marketing/ContactForm.tsx)
// so the two marketing forms stay in lockstep.
const S = {
  wrap:     { background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: "22px 22px 24px" },
  row:      { display: "grid", gap: 6, marginBottom: 14 },
  label:    { fontSize: 12.5, fontWeight: 600, color: "#0B1A2F", letterSpacing: "0.02em" },
  input:    { width: "100%", height: 38, padding: "0 12px", border: "1px solid #C6CDDA", borderRadius: 6, fontSize: 13.5, color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box" as const },
  textarea: { width: "100%", minHeight: 96, padding: "10px 12px", border: "1px solid #C6CDDA", borderRadius: 6, fontSize: 13.5, color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box" as const, lineHeight: 1.5, fontFamily: "Inter, sans-serif", resize: "vertical" as const },
  hint:     { fontSize: 12, color: "var(--ink-faint)" },
  actions:  { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, flexWrap: "wrap" as const },
  submit:   { background: "#0B1A2F", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  submitDisabled: { background: "var(--ink-faint)", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: "not-allowed" },
  notice:   { padding: "10px 14px", borderRadius: 6, fontSize: 13, lineHeight: 1.5, marginTop: 14, border: "1px solid transparent" },
  success:  { background: "#EAF3EA", borderColor: "#9FC8A4", color: "#22622A" },
  error:    { background: "#FBECEC", borderColor: "#E0A3A3", color: "#8A2A2A" },
};

export function BookDemoForm() {
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [company, setCompany]   = useState("");
  const [formats, setFormats]   = useState("");
  const [times, setTimes]       = useState("");
  const [message, setMessage]   = useState("");
  const [state, setState]       = useState<{ status: "idle" | "submitting" | "success" | "error"; message?: string }>({ status: "idle" });

  const canSubmit =
    state.status !== "submitting" &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    company.trim().length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ status: "submitting" });

    // Compose one readable plain-text body — the support pipeline forwards the
    // message verbatim to the founder's mailbox.
    const body = [
      `Name:            ${name.trim()}`,
      `Company:         ${company.trim()}`,
      `Orders in:       ${formats.trim() || "(not specified)"}`,
      `Preferred times: ${times.trim() || "(not specified)"}`,
      ...(message.trim() ? ["", message.trim()] : []),
    ].join("\n");

    try {
      const result = await apiClient.submitSupportRequest({
        category: "demo",
        subject: `Demo request — ${company.trim()}`,
        message: body,
        userEmail: email.trim(),
        route: "/book-demo",
      });
      if (result.delivered) {
        capture("demo_request_submitted", { from_route: "/book-demo" });
        setState({ status: "success", message: "Thanks — we'll reply within 1 business day to schedule." });
      } else {
        // The endpoint accepted the request but no email was actually sent
        // (e.g. sender not configured) — don't pretend it reached us.
        setState({
          status: "error",
          message: `Your request couldn't be sent automatically. Please email us directly at ${result.contactEmail} and we'll reply within 1 business day.`,
        });
      }
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "book_demo_form" },
        extra: { has_formats: Boolean(formats.trim()), has_times: Boolean(times.trim()) },
      });
      // Never render the raw error string (JSON bodies, timeout internals) —
      // map to a plain-language sentence a visitor can act on.
      setState({ status: "error", message: friendlySubmitError(err, "hello@proculink.eu") });
    }
  }

  // Move focus to the confirmation when the form unmounts on success — without
  // this, keyboard focus (on the just-pressed submit button) silently drops to
  // <body>, and screen readers get no reliable announcement of the outcome.
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div style={S.wrap} aria-label="Demo request sent">
        <div
          ref={successRef}
          tabIndex={-1}
          role="status"
          style={{ ...S.notice, ...S.success, marginTop: 0, outline: "none" }}
        >
          <strong>Request received.</strong> {state.message}
        </div>
        <p style={{ ...S.hint, marginTop: 12, marginBottom: 0 }}>
          Want to add anything in the meantime? Email{" "}
          <a href="mailto:hello@proculink.eu" style={{ color: "#1E6D29" }}>hello@proculink.eu</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={S.wrap} aria-label="Request a demo">
      <div style={S.row}>
        <label htmlFor="demo-name" style={S.label}>Name <span style={{ color: "#8A2A2A" }}>*</span></label>
        <input
          id="demo-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={S.input}
          required
          maxLength={200}
          autoComplete="name"
        />
      </div>

      <div style={S.row}>
        <label htmlFor="demo-email" style={S.label}>Work email <span style={{ color: "#8A2A2A" }}>*</span></label>
        <input
          id="demo-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          style={S.input}
          required
          maxLength={320}
          autoComplete="email"
        />
        <p style={{ ...S.hint, margin: 0 }}>We use this only to reply and schedule the call.</p>
      </div>

      <div style={S.row}>
        <label htmlFor="demo-company" style={S.label}>Company <span style={{ color: "#8A2A2A" }}>*</span></label>
        <input
          id="demo-company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company name"
          style={S.input}
          required
          maxLength={200}
          autoComplete="organization"
        />
      </div>

      <div style={S.row}>
        <label htmlFor="demo-formats" style={S.label}>What do you send or receive orders in?</label>
        <input
          id="demo-formats"
          type="text"
          value={formats}
          onChange={(e) => setFormats(e.target.value)}
          placeholder="e.g. PDFs by email, CSV exports, EDIFACT, cXML — whatever you have today"
          style={S.input}
          maxLength={500}
        />
      </div>

      <div style={S.row}>
        <label htmlFor="demo-times" style={S.label}>Preferred times</label>
        <input
          id="demo-times"
          type="text"
          value={times}
          onChange={(e) => setTimes(e.target.value)}
          placeholder="e.g. weekday mornings, CET"
          style={S.input}
          maxLength={300}
        />
      </div>

      <div style={S.row}>
        <label htmlFor="demo-message" style={S.label}>Anything else? <span style={S.hint}>(optional)</span></label>
        <textarea
          id="demo-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Suppliers or customers you'd like covered, questions you want answered…"
          style={S.textarea}
          maxLength={4000}
        />
      </div>

      <div style={S.actions}>
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
          Prefer email? <a href="mailto:hello@proculink.eu?subject=ProcuLink%20demo" style={{ color: "#1E6D29" }}>hello@proculink.eu</a>
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          style={canSubmit ? S.submit : S.submitDisabled}
        >
          {state.status === "submitting" ? "Sending…" : "Request a demo"}
        </button>
      </div>

      {state.status === "error" && (
        <div role="alert" style={{ ...S.notice, ...S.error }}>{state.message}</div>
      )}
    </form>
  );
}
