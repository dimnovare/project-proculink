"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { apiClient } from "@/lib/api-client";

type Category = "general" | "bug" | "billing" | "security";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "general",  label: "General question" },
  { value: "bug",      label: "Bug report" },
  { value: "billing",  label: "Billing" },
  { value: "security", label: "Security" },
];

const S = {
  wrap:     { background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12, padding: "22px 22px 24px", marginTop: 32 },
  legend:   { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 600, color: "#0B1A2F", margin: "0 0 4px" },
  lead:     { fontSize: 13.5, color: "#56627A", margin: "0 0 18px", lineHeight: 1.5 },
  row:      { display: "grid", gap: 6, marginBottom: 14 },
  label:    { fontSize: 12.5, fontWeight: 600, color: "#0B1A2F", letterSpacing: "0.02em" },
  input:    { width: "100%", height: 38, padding: "0 12px", border: "1px solid #C6CDDA", borderRadius: 6, fontSize: 13.5, color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box" as const },
  select:   { width: "100%", height: 38, padding: "0 12px", border: "1px solid #C6CDDA", borderRadius: 6, fontSize: 13.5, color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box" as const },
  textarea: { width: "100%", minHeight: 140, padding: "10px 12px", border: "1px solid #C6CDDA", borderRadius: 6, fontSize: 13.5, color: "#0B1A2F", background: "#FFFFFF", boxSizing: "border-box" as const, lineHeight: 1.5, fontFamily: "Inter, sans-serif", resize: "vertical" as const },
  hint:     { fontSize: 12, color: "#8A93A5", marginTop: 4 },
  actions:  { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, flexWrap: "wrap" as const },
  submit:   { background: "#0B1A2F", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  submitDisabled: { background: "#8A93A5", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, cursor: "not-allowed" },
  notice:   { padding: "10px 14px", borderRadius: 6, fontSize: 13, lineHeight: 1.5, marginTop: 14, border: "1px solid transparent" },
  success:  { background: "#EAF3EA", borderColor: "#9FC8A4", color: "#22622A" },
  error:    { background: "#FBECEC", borderColor: "#E0A3A3", color: "#8A2A2A" },
};

export function ContactForm() {
  const pathname = usePathname() ?? "(unknown)";
  const [category, setCategory] = useState<Category>("general");
  const [subject, setSubject]   = useState("");
  const [message, setMessage]   = useState("");
  const [email, setEmail]       = useState("");
  const [state, setState]       = useState<{ status: "idle" | "submitting" | "success" | "error"; message?: string }>({ status: "idle" });

  const canSubmit = state.status !== "submitting" && message.trim().length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ status: "submitting" });
    try {
      await apiClient.submitSupportRequest({
        category,
        subject: subject.trim() || "(no subject)",
        message: message.trim(),
        userEmail: email.trim() || undefined,
        route: pathname,
      });
      setState({ status: "success", message: "Thanks — we'll reply within one business day." });
      setSubject("");
      setMessage("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please email support@proculink.com instead.";
      setState({ status: "error", message: msg });
    }
  }

  return (
    <form onSubmit={onSubmit} style={S.wrap} aria-label="Contact support">
      <p style={S.legend}>Or write to us directly</p>
      <p style={S.lead}>
        Fill in the form below and we&apos;ll reply within one business day. Anonymous submissions
        are fine — just include an email so we can write back.
      </p>

      <div style={S.row}>
        <label htmlFor="contact-category" style={S.label}>Category</label>
        <select
          id="contact-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          style={S.select}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={S.row}>
        <label htmlFor="contact-subject" style={S.label}>Subject</label>
        <input
          id="contact-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="One-line summary"
          style={S.input}
          maxLength={200}
        />
      </div>

      <div style={S.row}>
        <label htmlFor="contact-message" style={S.label}>Message <span style={{ color: "#8A2A2A" }}>*</span></label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What can we help with? Steps to reproduce, screenshot links, anything that helps us respond faster."
          style={S.textarea}
          required
          maxLength={4000}
        />
      </div>

      <div style={S.row}>
        <label htmlFor="contact-email" style={S.label}>Email <span style={S.hint}>(required if you&apos;re not signed in)</span></label>
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          style={S.input}
          autoComplete="email"
        />
        <p style={S.hint}>We use this only to reply to your request.</p>
      </div>

      <div style={S.actions}>
        <p style={{ fontSize: 12.5, color: "#8A93A5", margin: 0 }}>
          Prefer email? <a href="mailto:support@proculink.com" style={{ color: "#1E66C9" }}>support@proculink.com</a>
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          style={canSubmit ? S.submit : S.submitDisabled}
        >
          {state.status === "submitting" ? "Sending…" : "Send message"}
        </button>
      </div>

      {state.status === "success" && (
        <div role="status" style={{ ...S.notice, ...S.success }}>{state.message}</div>
      )}
      {state.status === "error" && (
        <div role="alert" style={{ ...S.notice, ...S.error }}>{state.message}</div>
      )}
    </form>
  );
}
