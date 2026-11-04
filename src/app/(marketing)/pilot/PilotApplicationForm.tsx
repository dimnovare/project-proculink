"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { capture } from "@/lib/analytics";
import { friendlySubmitError } from "@/lib/friendly-submit-error";
import { captureException } from "@/lib/sentry-context";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Card } from "@/components/bridge/layout/Card";

// ─────────────────────────────────────────────────────────────────────────────
// Supported-pilot application.
//
// SUBMISSION — the same mechanism as /book-demo (BookDemoForm): one POST to
// /api/support/contact through apiClient.submitSupportRequest. No new endpoint.
// That endpoint carries a free-text `message`, a `subject`, a `category` and the
// reply-to `userEmail`; it has no structured fields. So every answer below is
// composed into the message body as labelled lines, exactly the way BookDemoForm
// folds its "orders in" and "preferred times" fields in, and the support pipeline
// forwards that body verbatim to the ProcuLink inbox.
//
// `category: "demo"` is reused deliberately: the frontend payload type allows a
// fixed set, and a new category would be a backend-contract change for no gain —
// the subject line ("Pilot application — <company>") is what tells the two apart.
//
// DELIBERATELY NOT ASKED: the supplier's name. Naming a supplier to a vendor you
// have not decided to trust is intrusive; it is agreed later, once the prospect has
// chosen to explore a pilot.
// ─────────────────────────────────────────────────────────────────────────────

type Choice = { name: string; legend: string; options: readonly string[] };

const REPEAT: Choice = {
  name: "repeat",
  legend: "Do you regularly order physical products from the same suppliers?",
  options: ["Yes", "No", "Not sure"],
};
const ITEM_CODES: Choice = {
  name: "item-codes",
  legend: "Do your item or part numbers differ from your suppliers' codes?",
  options: ["Often", "Sometimes", "Rarely", "Not sure"],
};
const FREQUENCY: Choice = {
  name: "frequency",
  legend: "How often does this kind of repeat order happen?",
  options: ["Weekly", "Monthly", "Less often", "Varies"],
};
const MANUAL_STEP: Choice = {
  name: "manual-step",
  legend: "What is the main manual step today?",
  options: ["Item-code lookup", "Reformatting", "Corrections", "Other"],
};
const FILE_TYPES = ["PDF", "Excel", "CSV", "Other"] as const;

type SubmitState = { status: "idle" | "submitting" | "success" | "error"; message?: string };

/** The message body the support inbox receives. Exported for the test that pins it. */
export function composePilotApplication(a: {
  name: string;
  company: string;
  country: string;
  role: string;
  repeat: string;
  itemCodes: string;
  files: readonly string[];
  frequency: string;
  manualStep: string;
  note: string;
}): string {
  const or = (v: string) => v.trim() || "(not answered)";
  return [
    "Supported pilot application",
    "",
    `Name:                 ${a.name.trim()}`,
    `Company:              ${a.company.trim()}`,
    `Country:              ${or(a.country)}`,
    `Role:                 ${or(a.role)}`,
    `Repeat purchasing:    ${or(a.repeat)}`,
    `Item codes differ:    ${or(a.itemCodes)}`,
    `PO files used:        ${a.files.length > 0 ? a.files.join(", ") : "(not answered)"}`,
    `Repeat frequency:     ${or(a.frequency)}`,
    `Main manual step:     ${or(a.manualStep)}`,
    ...(a.note.trim() ? ["", "Note:", a.note.trim()] : []),
  ].join("\n");
}

export function PilotApplicationForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [country, setCountry] = useState("");
  const [role, setRole] = useState("");
  const [repeat, setRepeat] = useState("");
  const [itemCodes, setItemCodes] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("");
  const [manualStep, setManualStep] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const canSubmit =
    state.status !== "submitting" &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    company.trim().length > 0;

  function toggleFile(kind: string) {
    setFiles((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ status: "submitting" });

    // List order, not click order, so every application reads the same way.
    const orderedFiles = FILE_TYPES.filter((k) => files.includes(k));
    const message = composePilotApplication({
      name, company, country, role, repeat, itemCodes,
      files: orderedFiles, frequency, manualStep, note,
    });

    try {
      const result = await apiClient.submitSupportRequest({
        category: "demo",
        subject: `Pilot application — ${company.trim()}`,
        message,
        userEmail: email.trim(),
        route: "/pilot",
      });
      if (result.delivered) {
        capture("pilot_application_submitted", { from_route: "/pilot" });
        setState({ status: "success", message: "Thanks — we'll reply within 1 business day." });
      } else {
        // Accepted but not actually sent (e.g. the sender is not configured). Don't pretend it
        // reached us — hand over the address instead.
        setState({
          status: "error",
          message: `Your application couldn't be sent automatically. Please email us at ${result.contactEmail} and we'll reply within 1 business day.`,
        });
      }
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "pilot_application_form" },
        extra: { has_note: Boolean(note.trim()), file_types: orderedFiles.length },
      });
      setState({ status: "error", message: friendlySubmitError(err, "hello@proculink.eu") });
    }
  }

  // Move focus to the confirmation when the form unmounts on success, so keyboard focus does
  // not drop to <body> and screen readers announce the outcome (same as BookDemoForm).
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <Card style={{ marginTop: 18 }} aria-label="Pilot application sent">
        <style>{FORM_CSS}</style>
        <div ref={successRef} tabIndex={-1} className="plk-apply-focus">
          <StatusNotice tone="success">
            <strong>Application received.</strong> {state.message}
          </StatusNotice>
        </div>
        <p className="plk-apply-hint plk-apply-hint-after">
          Want to add anything in the meantime? Email{" "}
          <a href="mailto:hello@proculink.eu" className="plk-apply-link">hello@proculink.eu</a>.
        </p>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 18 }}>
      <style>{FORM_CSS}</style>
      <form onSubmit={onSubmit} aria-label="Apply for a FREE supported pilot">

      <div className="plk-apply-grid">
        <TextField id="pilot-name" label="Name" required value={name} onChange={setName}
          placeholder="Your name" autoComplete="name" maxLength={200} />
        <TextField id="pilot-email" label="Work email" required type="email" value={email} onChange={setEmail}
          placeholder="you@company.com" autoComplete="email" maxLength={320}
          hint="We use this only to reply about the pilot." />
        <TextField id="pilot-company" label="Company" required value={company} onChange={setCompany}
          placeholder="Company" autoComplete="organization" maxLength={200} />
        <TextField id="pilot-country" label="Country" value={country} onChange={setCountry}
          placeholder="Country" autoComplete="country-name" maxLength={100} />
        <TextField id="pilot-role" label="Role" value={role} onChange={setRole}
          placeholder="Your role / job title" autoComplete="organization-title" maxLength={200} />
      </div>

      <RadioGroup choice={REPEAT} value={repeat} onChange={setRepeat} />
      <RadioGroup choice={ITEM_CODES} value={itemCodes} onChange={setItemCodes} />

      <fieldset className="plk-apply-fieldset">
        <legend className="plk-apply-legend">
          What do you normally use for purchase orders? <span className="plk-apply-optional">(choose any)</span>
        </legend>
        <div className="plk-apply-options">
          {FILE_TYPES.map((kind) => (
            <label key={kind} className="plk-apply-option">
              <input
                type="checkbox"
                name="po-files"
                value={kind}
                checked={files.includes(kind)}
                onChange={() => toggleFile(kind)}
              />
              <span>{kind}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <RadioGroup choice={FREQUENCY} value={frequency} onChange={setFrequency} />
      <RadioGroup choice={MANUAL_STEP} value={manualStep} onChange={setManualStep} />

      <div className="plk-apply-row">
        <label htmlFor="pilot-note" className="plk-apply-label">
          Anything else you would like us to know? <span className="plk-apply-optional">(optional)</span>
        </label>
        <textarea
          id="pilot-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="plk-apply-textarea"
          maxLength={4000}
        />
      </div>

      <div className="plk-apply-actions">
        <p className="plk-apply-hint">
          Prefer email?{" "}
          <a href="mailto:hello@proculink.eu?subject=ProcuLink%20pilot" className="plk-apply-link">
            hello@proculink.eu
          </a>
        </p>
        <button type="submit" disabled={!canSubmit} className="plk-apply-submit">
          {state.status === "submitting" ? "Sending…" : "Apply for a FREE supported pilot"}
        </button>
      </div>

      {state.status === "error" && (
        <div className="plk-apply-error">
          <StatusNotice tone="error">{state.message}</StatusNotice>
        </div>
      )}
      </form>
    </Card>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  maxLength: number;
  required?: boolean;
  type?: "text" | "email";
  hint?: string;
}) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div className="plk-apply-row">
      <label htmlFor={props.id} className="plk-apply-label">
        {props.label} {props.required && <span className="plk-apply-required" aria-hidden>*</span>}
      </label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="plk-apply-input"
        required={props.required}
        maxLength={props.maxLength}
        autoComplete={props.autoComplete}
        aria-describedby={hintId}
      />
      {props.hint && (
        <p id={hintId} className="plk-apply-hint">
          {props.hint}
        </p>
      )}
    </div>
  );
}

function RadioGroup({ choice, value, onChange }: { choice: Choice; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="plk-apply-fieldset">
      <legend className="plk-apply-legend">{choice.legend}</legend>
      <div className="plk-apply-options">
        {choice.options.map((option) => (
          <label key={option} className="plk-apply-option">
            <input
              type="radio"
              name={choice.name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Tokens only — see the note at the bottom of ./page.tsx. The surface is <Card>, the one card;
// the option chips carry a border and a radius but no fill of their own, so they are controls,
// not hand-rolled cards.
const FORM_CSS = `
.plk-apply-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.plk-apply-row { display: grid; gap: 6px; margin-bottom: 14px; align-content: start; }
.plk-apply-label, .plk-apply-legend { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.4; }
.plk-apply-required { color: var(--danger); }
.plk-apply-optional { font-weight: 400; color: var(--ink-muted); }
.plk-apply-input, .plk-apply-textarea {
  width: 100%; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  font-size: 14px; color: var(--ink); background: var(--surface); font-family: var(--font-sans);
}
.plk-apply-input { height: 42px; padding: 0 12px; }
.plk-apply-textarea { min-height: 96px; padding: 10px 12px; line-height: 1.5; resize: vertical; }
.plk-apply-input:focus-visible, .plk-apply-textarea:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 1px; }
.plk-apply-fieldset { border: 0; padding: 0; margin: 4px 0 16px; min-width: 0; }
.plk-apply-legend { padding: 0; margin-bottom: 8px; }
.plk-apply-options { display: flex; flex-wrap: wrap; gap: 8px; }
.plk-apply-option {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  font-size: 13.5px; color: var(--ink); cursor: pointer;
}
.plk-apply-option:has(input:checked) { border-color: var(--brand-blue); box-shadow: inset 0 0 0 1px var(--brand-blue); }
.plk-apply-option:has(input:focus-visible) { outline: 2px solid var(--brand-blue); outline-offset: 1px; }
.plk-apply-option input { accent-color: var(--brand-blue); margin: 0; }
.plk-apply-hint { font-size: 12.5px; color: var(--ink-muted); margin: 0; }
.plk-apply-hint-after { margin-top: 12px; }
.plk-apply-link { color: var(--brand-blue-deep); text-decoration: underline; text-underline-offset: 2px; }
.plk-apply-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
.plk-apply-submit {
  min-height: 44px; padding: 0 18px; border-radius: var(--radius-md); border: 1px solid transparent;
  background: var(--navy); color: var(--surface); font-size: 14px; font-weight: 600; cursor: pointer;
}
.plk-apply-submit:hover:not(:disabled) { background: var(--brand-blue-deep); }
.plk-apply-submit:disabled { background: var(--ink-muted); cursor: not-allowed; }
.plk-apply-submit:focus-visible { outline: 2px solid var(--brand-blue); outline-offset: 2px; }
.plk-apply-error { margin-top: 14px; }
.plk-apply-focus { outline: none; }
@media (max-width: 640px) {
  .plk-apply-grid { grid-template-columns: 1fr; }
  .plk-apply-submit { width: 100%; }
}
`;
