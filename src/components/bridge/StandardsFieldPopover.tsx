"use client";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { fieldRefList, getFieldStandards } from "@/lib/standards/catalog";

interface StandardsFieldPopoverProps {
  canonicalField: string;
  label?: string;
}

export function StandardsFieldPopover({ canonicalField, label }: StandardsFieldPopoverProps) {
  const refs = fieldRefList(canonicalField);

  // Self-hides when no standard mapping exists for this field.
  if (refs.length === 0) return null;

  const displayLabel =
    label ?? getFieldStandards(canonicalField)?.label ?? canonicalField;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Standards mapping for ${displayLabel}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 15,
            height: 15,
            borderRadius: "50%",
            border: "1.5px solid currentColor",
            background: "transparent",
            color: "var(--ink-faint)",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            transition: "color 120ms",
          }}
          onMouseEnter={(e) => {
            // #1E6D29 not #2E8E3A: the "i" is a 10px/700 glyph — text. At rest
            // --ink-faint is 4.9748:1 on white, so hovering to green's 4.1613:1
            // dropped it under AA. green-deep is 6.4128:1, so hover goes darker.
            (e.currentTarget as HTMLButtonElement).style.color = "#1E6D29";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-faint)";
          }}
        >
          i
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto min-w-[240px] p-3"
        align="start"
        data-testid="standards-field-popover"
      >
        {/* Field heading */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-faint)",
            marginBottom: 8,
          }}
        >
          {displayLabel}
        </div>

        {/* Standard reference rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {refs.map(({ label: stdLabel, ref }) => (
            <div
              key={stdLabel}
              style={{ display: "flex", alignItems: "baseline", gap: 8 }}
            >
              {/* Standard tag */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0B1A2F",
                  whiteSpace: "nowrap",
                  minWidth: 72,
                  flexShrink: 0,
                }}
              >
                {stdLabel}
              </span>

              {/* Reference path */}
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  // #1E6D29 not #2E8E3A: 11.5px reference-path TEXT on
                  // --popover (#FFFFFF) is 4.1613:1 with green, 6.4128:1 here.
                  color: "#1E6D29",
                  wordBreak: "break-all",
                }}
              >
                {ref}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
