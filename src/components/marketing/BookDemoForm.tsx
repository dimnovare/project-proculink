"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { friendlySubmitError } from "@/lib/friendly-submit-error";
import { captureException } from "@/lib/sentry-context";
import { Card } from "@/components/bridge/layout/Card";
import { FORM } from "@/components/marketing/ContactForm";
import { INK_CTA } from "@/components/marketing/LegalPage";

// Same visual grammar as ContactForm (FORM), so the two marketing forms stay in lockstep.

function Field({
  id,
  label,
  optional,
  hint,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={FORM.row}>
      <label htmlFor={id} className={FORM.label}>
        {label}
        {optional && <> <span className={FORM.opt}>(optional)</span></>}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className={FORM.hint}>{hint}</p>}
    </div>
  );
}

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
    // A second press while one request is out sends nothing.
    if (!canSubmit) return;
    setState({ status: "submitting" });

    // Compose one readable plain-text body — the support pipeline forwards the
    // message verbatim to the founder's mailbox.
    const body = [
      `Name:            ${name.trim()}`,
      `Company:         ${company.trim()}`,
      `Documents in:    ${formats.trim() || "(not specified)"}`,
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
      <Card aria-label="Call request sent">
        <div ref={successRef} tabIndex={-1} role="status" className={`${FORM.ok} outline-none`}>
          <strong>Request received.</strong> {state.message}
        </div>
        <p className={`${FORM.hint} mt-3`}>
          Want to add anything in the meantime? Email{" "}
          <a href="mailto:hello@proculink.eu" className="text-brand-blue-deep underline">hello@proculink.eu</a>.
        </p>
      </Card>
    );
  }

  return (
    // /book-demo is framed as a 20-minute call about one of the visitor's documents,
    // not a generic demo — the form's own labels say the same thing as the page around it.
    <Card>
      <form onSubmit={onSubmit} aria-label="Request a 20-minute call" className="flex flex-col gap-5">
        <h2 className="font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.015em]">Request a call</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-x-4 gap-y-5">
          <Field id="demo-name" label="Name">
            <input
              id="demo-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FORM.field}
              required
              maxLength={200}
              autoComplete="name"
            />
          </Field>
          <Field id="demo-email" label="Work email" hint="We use this only to reply and schedule the call.">
            <input
              id="demo-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FORM.field}
              required
              maxLength={320}
              autoComplete="email"
              aria-describedby="demo-email-hint"
            />
          </Field>
        </div>

        <Field id="demo-company" label="Company">
          <input
            id="demo-company"
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className={FORM.field}
            required
            maxLength={200}
            autoComplete="organization"
          />
        </Field>

        <Field
          id="demo-formats"
          label="What format are your documents in?"
          optional
          hint="For example: PDF invoices, Excel price lists, scans."
        >
          <input
            id="demo-formats"
            type="text"
            value={formats}
            onChange={(e) => setFormats(e.target.value)}
            className={FORM.field}
            maxLength={500}
            aria-describedby="demo-formats-hint"
          />
        </Field>

        <Field id="demo-times" label="Preferred times" optional hint="For example: Tuesday or Thursday afternoon, EET.">
          <input
            id="demo-times"
            type="text"
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            className={FORM.field}
            maxLength={300}
            aria-describedby="demo-times-hint"
          />
        </Field>

        <Field id="demo-message" label="Anything else?" optional>
          <textarea
            id="demo-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${FORM.area} !min-h-[116px]`}
            maxLength={4000}
          />
        </Field>

        <div className="flex flex-col gap-3 pt-1">
          <button type="submit" disabled={!canSubmit} className={`${INK_CTA} w-full`}>
            {state.status === "submitting" ? "Sending…" : "Request a call"}
          </button>
          {state.status === "error" && <p role="alert" className={FORM.bad}>{state.message}</p>}
          <p className="text-center text-[15px] text-ink-muted">We reply within 1 business day.</p>
        </div>
      </form>
    </Card>
  );
}
