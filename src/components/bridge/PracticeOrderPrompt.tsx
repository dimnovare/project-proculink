"use client";

// PracticeOrderPrompt — the one CTA that starts an onboarding practice order.
//
// WP-27: a practice order only reaches `delivered` if we know where to email the
// finished file, so the CTA asks for one address before it starts the run. The address
// is prefilled from the signed-in user because their own inbox is the answer that needs
// nobody else's cooperation — which is the entire point of the practice run — but it is
// always SHOWN and always editable. We never mail someone at an address they did not
// read, and a shared purchasing inbox is a perfectly normal answer.
//
// Two clicks, not a form: the field only appears once the user has said they want the
// run. Used by the dashboard checklist, /upload and the inbox empty state so all three
// entry points behave identically.

import { useEffect, useState } from "react";
import { usePracticeOrderEmail } from "@/hooks/useSampleOrder";

const T = {
  ink: "#0B1A2F",
  blueDeep: "#0F4FA8",
  greenBtn: "#297F34", // solid fill under white text — 4.63:1 on white text, AA
  border: "#E5E8EE",
  muted: "#5E6779",
  faint: "#7A8399",
};

/** Same shape-check the backend's NormaliseEmail applies: one parseable address. */
export function isPracticeEmailUsable(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(",") || trimmed.includes(";")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface PracticeOrderPromptProps {
  /** Collapsed-state button label. Entry points word this differently. */
  ctaLabel?: string;
  pending: boolean;
  onRun: (deliverTo: string) => void;
  /** Renders the collapsed CTA as a filled button rather than a quiet text link. */
  variant?: "link" | "button";
  /**
   * The counterparty noun, already lower-cased, from `partyLabels(direction)` —
   * "supplier" outbound, "customer" inbound. Never hardcode it: an inbound org has
   * no suppliers, so "nothing goes to a real supplier" is a sentence about a party
   * it does not have, and shipping it silently deletes the inbound mode.
   *
   * Defaulted rather than required because every current caller is inside the
   * signed-in app and can supply it; the default keeps a future caller that has no
   * direction in scope from silently rendering "undefined".
   */
  nounLower?: string;
}

export function PracticeOrderPrompt({
  ctaLabel = "Try a practice order →",
  pending,
  onRun,
  variant = "link",
  nounLower = "supplier",
}: PracticeOrderPromptProps) {
  const defaultEmail = usePracticeOrderEmail();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  // Clerk resolves the user after first paint; adopt the address when it arrives, but
  // never overwrite something the user has already typed.
  useEffect(() => {
    if (defaultEmail) setEmail((current) => (current ? current : defaultEmail));
  }, [defaultEmail]);

  const ready = isPracticeEmailUsable(email);

  if (!open) {
    return (
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={pending}
          className={
            variant === "button"
              ? "w-full rounded-[6px] px-4 text-[13px] font-semibold transition-all sm:w-auto"
              : "inline-flex items-center text-[12px] font-semibold"
          }
          style={
            variant === "button"
              ? {
                  minHeight: 44,
                  background: pending ? "#E5E8EE" : T.ink,
                  color: pending ? T.faint : "#FFFFFF",
                  border: "none",
                  cursor: pending ? "not-allowed" : "pointer",
                }
              : {
                  minHeight: 44,
                  color: pending ? T.muted : T.blueDeep,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: pending ? "default" : "pointer",
                }
          }
        >
          {pending ? "Starting practice order…" : ctaLabel}
        </button>
        <p className="mt-0.5 max-w-[340px] text-[11px] leading-snug" style={{ color: T.faint }}>
          One example order, start to finish. Tell us where to send the finished file —
          it&apos;s free, doesn&apos;t count against your plan, and never reaches a real {nounLower}.
        </p>
      </div>
    );
  }

  return (
    <form
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) onRun(email.trim());
      }}
    >
      <label
        htmlFor="practice-deliver-to"
        className="block text-[11px] font-semibold uppercase"
        style={{ color: T.faint, letterSpacing: "0.05em" }}
      >
        Send the finished file to
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id="practice-deliver-to"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@your-company.example"
          disabled={pending}
          autoFocus
          className="min-w-[200px] flex-1 rounded-[6px] px-2.5"
          // 16px is the iOS zoom floor — a smaller input zooms the viewport on focus.
          style={{ height: 44, fontSize: 16, border: `1px solid ${T.border}`, color: T.ink }}
        />
        <button
          type="submit"
          disabled={!ready || pending}
          className="inline-flex items-center rounded-[6px] px-3.5 text-[12.5px] font-semibold"
          style={{
            minHeight: 44,
            background: !ready || pending ? "#CBD0DA" : T.greenBtn,
            color: "#fff",
            border: "none",
            cursor: !ready || pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Starting…" : "Run it"}
        </button>
      </div>
      <p className="mt-1 max-w-[340px] text-[11px] leading-snug" style={{ color: T.faint }}>
        Free — it doesn&apos;t count against your plan, and nothing goes to a real {nounLower}.
      </p>
    </form>
  );
}
