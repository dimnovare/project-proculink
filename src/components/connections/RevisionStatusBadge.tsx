import * as React from "react";

/* =====================================================================
   RevisionStatusBadge — the canonical badge for a Supplier Connection
   revision's lifecycle state (draft → test → published → archived).

   UnifiedStatusBadge covers the order lifecycle; it knows `draft` and
   `archived` (both neutral) but not `test`/`published`, and it does not
   convey the "this is the live revision" emphasis. This badge maps the
   four connection states to the locked semantic tokens, mirroring
   UnifiedStatusBadge's construction so the two read consistently.

   Server-component safe (no hooks / handlers).
   ===================================================================== */

export type RevisionTone = "success" | "info" | "neutral";

type ToneStyle = { bg: string; fg: string };

const TONE_STYLE: Record<RevisionTone, ToneStyle> = {
  success: { bg: "var(--brand-green-soft)", fg: "var(--brand-green-deep)" },
  info: { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)" },
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-muted)" },
};

type Meta = { label: string; tone: RevisionTone; title: string };

// Plain-language labels for the lifecycle states. The internal status strings
// (draft/test/published/archived) stay unchanged on the wire — only what the
// user reads changes: "published" → "Live", "archived" → "Previous". Each state
// carries a plain-language `title` tooltip so a non-technical user can hover the
// badge to learn what it means (wherever the badge is shown — drawer + list).
const META: Record<string, Meta> = {
  draft: { label: "Draft", tone: "neutral", title: "A work-in-progress you're editing. Test it before making it live." },
  test: { label: "Tested", tone: "info", title: "Passed its checks — ready to make live." },
  published: { label: "Live", tone: "success", title: "Orders are using this version now." },
  archived: { label: "Previous", tone: "neutral", title: "An older version you can restore if needed." },
};

function humanize(status: string): string {
  const s = (status ?? "").trim();
  if (!s) return "Unknown";
  const spaced = s.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function revisionStatusLabel(status: string): string {
  return META[(status ?? "").toLowerCase()]?.label ?? humanize(status);
}

export function revisionStatusTone(status: string): RevisionTone {
  return META[(status ?? "").toLowerCase()]?.tone ?? "neutral";
}

type Props = {
  status: string;
  size?: "sm" | "md";
  className?: string;
};

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-5 px-2 text-[11px]",
  md: "h-6 px-2.5 text-[12px]",
};

export function RevisionStatusBadge({ status, size = "sm", className }: Props) {
  const key = (status ?? "").toLowerCase();
  const meta = META[key] ?? { label: humanize(status), tone: "neutral" as const, title: "" };
  const tone = TONE_STYLE[meta.tone];

  return (
    <span
      title={meta.title || undefined}
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        SIZE[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ background: tone.bg, color: tone.fg, cursor: meta.title ? "help" : undefined }}
    >
      <span
        aria-hidden
        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: "currentColor" }}
      />
      {meta.label}
    </span>
  );
}

export default RevisionStatusBadge;
