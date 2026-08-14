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
//
// ── `test` states no verdict, because this badge never reads one ─────────────
//
// The `test` title used to read "Passed its checks — ready to make live." It was
// a verdict, and the only input this component has is `status` — a string that
// cannot carry one. Verified against the C#, not inferred:
//
//   ProcuLink.Api/Services/SupplierConnectionService.cs:259
//     rev.Status = "test";
//
// sits at the end of `MarkTestAsync`, AFTER the pack runs and OUTSIDE any
// `if (passed)`. `RunTestPackAsync` catches its own exceptions and converts them
// to `passed = false` (:229-237), so no failure — not even a thrown one — can
// route around line 259. The endpoint agrees: `ConnectionsController.cs:277-291`
// returns 200 with `Passed=false`; non-2xx is reserved for 404/409. So `test`
// means the checks RAN. It does not mean they passed, and a revision whose pack
// failed rendered "Passed its checks" in the same drawer as a Publish button
// that was correctly disabled.
//
// Reading the real signal instead is not available here. The pass/fail column
// (`test_passed`, `SupplierConnectionRevision.cs:60-62`) is surfaced only on the
// full single-revision DTO (`ConnectionDto.cs:23`); the ROW shape this badge is
// rendered from — `ConnectionRevisionSummaryDto`, `ConnectionDto.cs:15-17`, and
// its mirror `ConnectionRevisionSummary` in `src/lib/api/types.ts` — has no such
// field, and neither does the replay result behind the other call site.
//
// It would not be enough even if it were plumbed. `test_passed = true` is
// written with zero assertions evaluated when the supplier has no orders yet
// (`SupplierConnectionService.cs:614-625`), a skipped conformance leg counts as
// a pass (:703), and one rendered order out of five passes the replay leg
// (:648). And `true` is not durable: `UpdateDraftAsync:191` sets the column back
// to NULL on every content edit WITHOUT resetting `Status`, so `test` +
// `testPassed: null` is an ordinary present-day state, not just a legacy row.
//
// So the title says what `status` alone supports — the checks were run — and
// sends the user to the one place the verdict is actually visible: running them
// again. The stored evidence is never re-read into this UI (`testEvidence` in
// `useConnectionRevisions.ts:77` is session state that starts null), so it is
// gone after a reload while this badge persists — pointing at a panel to "open"
// would name something that is not there.
//
// ── What would let this badge say more ───────────────────────────────────────
//
// Adding `TestPassed` (and `TestedAt`) to `ConnectionRevisionSummaryDto`
// (`ProcuLink.Api/Contracts/ConnectionDto.cs:15-17`) and its frontend mirror
// `ConnectionRevisionSummary` (`src/lib/api/types.ts`) is the change that would
// put a real signal in front of this component. That is a backend packet, not
// this one. When it lands, two rules survive it:
//
//   • `false` is the only value that licenses distinct failure wording.
//   • `null` is NOT a pass. It is the value for never-tested rows, for legacy
//     rows the migration never backfilled, and for every revision edited since
//     its last run — so the fallback for null stays the neutral sentence below.
//     Rendering absent evidence as success is this same defect one level down.
const META: Record<string, Meta> = {
  draft: { label: "Draft", tone: "neutral", title: "A work-in-progress you're editing. Test it before making it live." },
  test: { label: "Tested", tone: "info", title: "Checks have been run on this version. Run them again to see the result." },
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
