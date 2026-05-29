import { STANDARDS, supportLabel } from "@/lib/standards/catalog";
import type { StandardFamily, SupportLevel } from "@/lib/standards/catalog";

// ── Family display config ────────────────────────────────────────────────────

const FAMILY_ORDER: StandardFamily[] = ["xml", "edi", "tabular", "reference"];

const FAMILY_LABELS: Record<StandardFamily, string> = {
  xml:       "XML-based",
  edi:       "EDI",
  tabular:   "Tabular · document · API",
  reference: "Reference-only",
};

/** 3px cross-section top strip color per family. */
const FAMILY_STRIP: Record<StandardFamily, string> = {
  xml:       "#1E66C9",
  edi:       "#C97A14",
  tabular:   "#2E8E3A",
  reference: "#56627A",
};

// ── Badge config ──────────────────────────────────────────────────────────────

type BadgeStyle = { color: string; background: string };

function badgeStyle(level: SupportLevel): BadgeStyle | null {
  switch (level) {
    case "supported": return { color: "#1E6D29", background: "#E2F1E2" };
    case "partial":   return { color: "#C97A14", background: "#FAEFD6" };
    case "planned":   return { color: "#56627A", background: "#EFF2F7" };
    case "none":      return null;
  }
}

function SupportBadge({
  direction,
  level,
  testId,
}: {
  direction: string;
  level: SupportLevel;
  testId: string;
}) {
  const style = badgeStyle(level);
  if (!style) {
    return (
      <span
        data-testid={testId}
        data-level={level}
        className="text-[11.5px]"
        style={{ color: "#8A93A5" }}
      >
        {direction}: —
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-level={level}
      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold"
      style={style}
    >
      {direction}: {supportLabel(level)}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StandardsPage() {
  const grouped: Record<StandardFamily, typeof STANDARDS> = {
    xml:       [],
    edi:       [],
    tabular:   [],
    reference: [],
  };
  for (const s of STANDARDS) {
    grouped[s.family].push(s);
  }

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ background: "#F6F7FA" }}
    >
      {/* ── Page header ───────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 py-4 sm:px-6"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <h1
          className="text-[26px] font-semibold tracking-[-0.02em]"
          style={{
            fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
            color: "#0B1A2F",
          }}
        >
          Standards
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: "#56627A" }}>
          Which procurement formats ProcuLink supports, in which direction.{" "}
          <span style={{ color: "#8A93A5" }}>{STANDARDS.length} standards</span>
        </p>
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-5 space-y-8">
        {FAMILY_ORDER.map((family) => {
          const items = grouped[family];
          if (items.length === 0) return null;
          return (
            <section key={family}>
              {/* Section heading */}
              <h2
                className="mb-3 text-[11px] font-bold uppercase tracking-[0.07em]"
                style={{ color: "#8A93A5" }}
              >
                {FAMILY_LABELS[family]}
              </h2>

              {/* Cards grid */}
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(340px,1fr))",
                }}
              >
                {items.map((s) => (
                  <div
                    key={s.id}
                    data-testid={`standard-${s.id}`}
                    className="rounded-[8px] overflow-hidden"
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E2E6EE",
                      boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                      borderTop: `3px solid ${FAMILY_STRIP[s.family]}`,
                    }}
                  >
                    <div className="p-4">
                      {/* Name + version row */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span
                          className="text-[14px] font-semibold leading-snug"
                          style={{ color: "#0B1A2F" }}
                        >
                          {s.name}
                        </span>
                        <span
                          className="flex-shrink-0 text-[11px]"
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            color: "#8A93A5",
                          }}
                        >
                          {s.version}
                        </span>
                      </div>

                      {/* Badges row */}
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <SupportBadge
                          direction="Parse"
                          level={s.parse}
                          testId="parse-badge"
                        />
                        <SupportBadge
                          direction="Transform"
                          level={s.transform}
                          testId="transform-badge"
                        />
                      </div>

                      {/* Transport */}
                      <p
                        className="text-[12px] mb-2 leading-relaxed"
                        style={{ color: "#56627A" }}
                      >
                        <span
                          className="font-semibold uppercase text-[10px] tracking-[0.06em] mr-1"
                          style={{ color: "#8A93A5" }}
                        >
                          Transport
                        </span>
                        {s.transport}
                      </p>

                      {/* Conformance note */}
                      <p
                        className="text-[11.5px] leading-relaxed mb-3"
                        style={{ color: "#56627A" }}
                      >
                        {s.conformance}
                      </p>

                      {/* Reference link */}
                      <a
                        href={s.referenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium"
                        style={{ color: "#1E66C9" }}
                      >
                        Spec reference ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
