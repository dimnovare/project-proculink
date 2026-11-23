"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { friendlySubmitError } from "@/lib/friendly-submit-error";
import { captureException } from "@/lib/sentry-context";
import { PROBLEM_COPY, isProblemStatus } from "@/components/bridge/problem/problemCopy";
import { SITE } from "@/components/marketing/sitePictures";

type Category = "general" | "bug" | "billing" | "security";

/**
 * A stuck order's "Get help with this order" links here carrying what the product
 * already knows: /support?order=PO-4711&problem=delivery_failed. Both params used to
 * be ignored, so the operator arrived at a blank form and retyped it.
 *
 * `problem` is a STATUS KEY and is never shown as one. PROBLEM_COPY is the same
 * record the order screen's panel renders, so the words in this subject line and the
 * words the operator just read are one source rather than two lists that drift.
 * Anything it does not recognise prefills nothing — better a blank form than
 * "Order undefined —" or a raw `delivery_dead_letter` in front of a customer.
 */
export function supportSubjectFor(
  orderParam: string | null | undefined,
  problemParam: string | null | undefined,
): string {
  const po = (orderParam ?? "").trim();
  // poTitleFrom() renders an order whose PO number is blank as the bare word
  // "Order", and the link carries that verbatim. Treat it as "no PO number known"
  // rather than emitting "Order Order — …".
  const named = po && po.toLowerCase() !== "order" ? `Order ${po}` : "";
  const problem = isProblemStatus(problemParam) ? PROBLEM_COPY[problemParam].badge : "";

  if (named && problem) return `${named} — ${problem}`;
  return named || problem;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "general",  label: "General question" },
  { value: "bug",      label: "Something isn't working" },
  { value: "billing",  label: "Billing" },
  { value: "security", label: "Security" },
];

/** The site's form grammar, shared with BookDemoForm: 48px fields, 16px text, 15.5px labels. */
export const FORM = {
  row: "flex min-w-0 flex-col gap-2",
  label: "text-[15.5px] font-semibold text-ink",
  opt: "font-normal text-ink-muted",
  field:
    "h-12 w-full rounded-[10px] border border-border-strong bg-surface px-3.5 text-[16px] text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue-soft",
  area: "min-h-[150px] w-full resize-y rounded-[10px] border border-border-strong bg-surface px-3.5 py-3 text-[16px] leading-[1.5] text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue-soft",
  hint: "text-[14.5px] text-ink-muted",
  ok: "text-[15.5px] font-semibold text-brand-green-deep",
  bad: "text-[15.5px] font-semibold text-danger",
} as const;

type Needed = { id: string; value: string; message: string; email?: boolean };

/**
 * The needed-field check both site forms run on press (the button is never greyed out):
 * returns each missing field's message by id and moves focus to the first one.
 */
export function checkNeeded(fields: Needed[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = f.value.trim();
    if (!v || (f.email && !/^\S+@\S+\.\S+$/.test(v))) errors[f.id] = f.message;
  }
  const first = fields.find((f) => errors[f.id]);
  if (first) document.getElementById(first.id)?.focus();
  return errors;
}

/** The field's inline message, and the props that tie the field to it. */
export function fieldError(id: string, errors: Record<string, string>, hint?: string) {
  const message = errors[id];
  return {
    props: { "aria-invalid": message ? true : undefined, "aria-describedby": [hint, message && `${id}-error`].filter(Boolean).join(" ") || undefined },
    node: message ? <p id={`${id}-error`} className={FORM.bad}>{message}</p> : null,
  };
}

/** The form, opened on `initialSubject`. Paints the same frame before and after the address is read. */
export function ContactForm({ initialSubject }: { initialSubject: string }) {
  const pathname = usePathname() ?? "(unknown)";
  const [category, setCategory] = useState<Category>("general");
  // Seeded from the URL, then owned by the field: a prefilled input the user can
  // edit needs local state by definition, and re-deriving it per render would undo
  // their typing. The URL is the opening value here, not the source of truth.
  const [subject, setSubject]   = useState(initialSubject);
  const [message, setMessage]   = useState("");
  const [email, setEmail]       = useState("");
  const [state, setState]       = useState<{ status: "idle" | "submitting" | "success" | "error"; message?: string }>({ status: "idle" });

  const [errors, setErrors]     = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // A second press while one request is out sends nothing.
    if (state.status === "submitting") return;
    const missing = checkNeeded([
      { id: "contact-message", value: message, message: "Write your message" },
      { id: "contact-email", value: email, message: "Enter your email", email: true },
    ]);
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setState({ status: "submitting" });
    try {
      const result = await apiClient.submitSupportRequest({
        category,
        subject: subject.trim() || "(no subject)",
        message: message.trim(),
        userEmail: email.trim() || undefined,
        route: pathname,
      });
      if (result.delivered) {
        setState({ status: "success", message: "Thanks — we'll reply within one business day." });
        setSubject("");
        setMessage("");
      } else {
        // The endpoint accepted the request but no email was actually sent
        // (e.g. SMTP not configured) — don't pretend it reached us.
        setState({
          status: "error",
          message: `Your message couldn't be sent automatically. Please email us directly at ${result.contactEmail} and we'll reply within one business day.`,
        });
      }
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "contact_form", category },
        extra: { route: pathname, has_email: Boolean(email.trim()) },
      });
      // Never render the raw error string (JSON bodies, timeout internals) —
      // map to a plain-language sentence a visitor can act on.
      setState({ status: "error", message: friendlySubmitError(err, "support@proculink.eu") });
    }
  }

  const messageErr = fieldError("contact-message", errors, "contact-message-hint");
  const emailErr = fieldError("contact-email", errors, "contact-email-hint");

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Contact support" className="flex flex-col gap-[22px]">
      <h2 className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">Write to us</h2>
      <p className={FORM.hint}>Your message and email are needed.</p>

      <div className={FORM.row}>
        <label htmlFor="contact-category" className={FORM.label}>What is it about?</label>
        <select
          id="contact-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className={FORM.field}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className={FORM.row}>
        <label htmlFor="contact-subject" className={FORM.label}>
          Subject <span className={FORM.opt}>(optional)</span>
        </label>
        <input
          id="contact-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={FORM.field}
          maxLength={200}
        />
      </div>

      <div className={FORM.row}>
        <label htmlFor="contact-message" className={FORM.label}>Message</label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={FORM.area}
          required
          maxLength={4000}
          {...messageErr.props}
        />
        {messageErr.node}
        <p id="contact-message-hint" className={FORM.hint}>The more detail you give, the faster we can help.</p>
      </div>

      <div className={FORM.row}>
        <label htmlFor="contact-email" className={FORM.label}>Your email</label>
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FORM.field}
          required
          autoComplete="email"
          {...emailErr.props}
        />
        {emailErr.node}
        <p id="contact-email-hint" className={FORM.hint}>We use this only to reply to your request.</p>
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:items-start">
        <button type="submit" disabled={state.status === "submitting"} className={SITE.cta}>
          {state.status === "submitting" ? "Sending…" : "Send message"}
        </button>
        {state.status === "success" && <p role="status" className={FORM.ok}>{state.message}</p>}
        {state.status === "error" && <p role="alert" className={FORM.bad}>{state.message}</p>}
      </div>
    </form>
  );
}

/** The form opened on what a "Get help with this order" link carries in its address. */
export function ContactFormFromAddress() {
  const params = useSearchParams();
  return <ContactForm initialSubject={supportSubjectFor(params.get("order"), params.get("problem"))} />;
}
