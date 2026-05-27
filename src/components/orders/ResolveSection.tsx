"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderLine } from "@/types/procurement";

interface ResolveSectionProps {
  order: Order;
  onOrderUpdated: (order: Order, messages: string[]) => void;
}

// ─── Design tokens (mirrors the rest of the order detail view) ────────────────
const T = {
  surface:     "#FFFFFF",
  surface2:    "#F1F3F7",
  border:      "#E2E6EE",
  borderFaint: "#EEF0F4",
  borderStrong:"#CBD0DA",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  amber:       "#C97A14",
  amberSoft:   "#FAEFD6",
  navy:        "#0B1A2F",
  mono:        '"JetBrains Mono", ui-monospace, monospace',
  ui:          '"Inter", system-ui, sans-serif',
};

export function ResolveSection({ order, onOrderUpdated }: ResolveSectionProps) {
  const unresolvedLines = order.lines.filter((l) => l.needsReview);

  // resolutions: the current value in the input for each unresolved line
  const [resolutions, setResolutions] = useState<Record<number, string>>(() => {
    const seed: Record<number, string> = {};
    unresolvedLines.forEach((l) => {
      seed[l.lineNumber] = l.aiSuggestion?.supplierItemCode ?? "";
    });
    return seed;
  });

  // touched: which inputs the user has hand-edited. Used to flip the prefill
  // back to "full ink" once they take ownership of the value.
  const [touched, setTouched] = useState<Record<number, boolean>>({});

  const [saveMappings, setSaveMappings] = useState(true);
  const [isResolving,  setIsResolving]  = useState(false);

  const allFilled = unresolvedLines.every(
    (l) => resolutions[l.lineNumber]?.trim(),
  );

  const handleChange = (lineNumber: number, value: string) => {
    setResolutions((p) => ({ ...p, [lineNumber]: value }));
    setTouched((p) => ({ ...p, [lineNumber]: true }));
  };

  const handleClear = (lineNumber: number) => {
    setResolutions((p) => ({ ...p, [lineNumber]: "" }));
    setTouched((p) => ({ ...p, [lineNumber]: true }));
  };

  const handleResolve = async () => {
    if (!allFilled) return;
    setIsResolving(true);
    try {
      const result = await apiClient.resolvePurchaseOrder(order.id, {
        saveMappings,
        lineResolutions: unresolvedLines.map((l) => ({
          lineNumber:       l.lineNumber,
          supplierItemCode: resolutions[l.lineNumber].trim(),
        })),
      });

      toast({
        title:       result.order.status === "ready" ? "All lines resolved" : "Partially resolved",
        description: result.order.status === "ready"
          ? "Order is ready for transformation."
          : "Some lines still need supplier item codes.",
      });

      onOrderUpdated(result.order, result.validationMessages);
    } catch (err) {
      toast({
        title:       "Resolution failed",
        description: err instanceof Error ? err.message : "An error occurred",
        variant:     "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(n);

  const fmtPct = (c: number) => `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%`;

  if (unresolvedLines.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <section style={{
        background: T.surface,
        border:     `1px solid ${T.border}`,
        borderRadius: 10,
        overflow:   "hidden",
        fontFamily: T.ui,
      }}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <header style={{
          padding: "12px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
              Resolve {unresolvedLines.length} missing supplier code
              {unresolvedLines.length === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 11.5, color: T.inkFaint, marginTop: 2 }}>
              AI suggestions are prefilled — review each one before saving.
            </div>
          </div>
        </header>

        {/* ── Grid ─────────────────────────────────────────────────────────── */}
        <div role="table" style={{ display: "grid", gridTemplateColumns: "40px 1.1fr 1.7fr 60px 80px 1.4fr 32px" }}>
          {/* row 1: header */}
          <HeadCell>Line</HeadCell>
          <HeadCell>Buyer SKU</HeadCell>
          <HeadCell>Description</HeadCell>
          <HeadCell align="right">Qty</HeadCell>
          <HeadCell align="right">Price</HeadCell>
          <HeadCell>Supplier code</HeadCell>
          <HeadCell />

          {unresolvedLines.map((line) => {
            const suggestion   = line.aiSuggestion;
            const value        = resolutions[line.lineNumber] ?? "";
            const isPrefilled  = !!suggestion && !touched[line.lineNumber] && value === suggestion.supplierItemCode;

            return (
              <ResolveRow
                key={line.id}
                line={line}
                value={value}
                isPrefilled={isPrefilled}
                onChange={(v) => handleChange(line.lineNumber, v)}
                onClear={()  => handleClear(line.lineNumber)}
                priceLabel={fmt(line.unitPrice)}
                pctLabel={suggestion ? fmtPct(suggestion.confidence) : null}
                tooltip={suggestion ? `${suggestion.reason} · ${suggestion.provenance}` : null}
              />
            );
          })}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer style={{
          padding: "12px 20px",
          background: T.surface2,
          borderTop: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <label
            htmlFor="save-mappings"
            style={{
              display: "inline-flex", alignItems: "center", gap: 9,
              fontSize: 12.5, color: T.inkMuted, cursor: "pointer",
            }}
          >
            <Checkbox
              id="save-mappings"
              checked={saveMappings}
              onCheckedChange={(c) => setSaveMappings(c === true)}
            />
            Save as mappings for future orders
          </label>

          <button
            onClick={handleResolve}
            disabled={!allFilled || isResolving}
            style={{
              marginLeft: "auto",
              height: 32, padding: "0 16px", borderRadius: 6,
              background:  T.navy,
              border:     `1px solid ${T.navy}`,
              color: "#fff", fontSize: 12.5, fontWeight: 600,
              cursor: allFilled && !isResolving ? "pointer" : "not-allowed",
              opacity: allFilled && !isResolving ? 1 : 0.45,
              fontFamily: T.ui,
              display: "inline-flex", alignItems: "center", gap: 7,
            }}
          >
            {isResolving ? "Resolving…" : "Resolve and continue"}
          </button>
        </footer>
      </section>
    </TooltipProvider>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ResolveRow({
  line,
  value,
  isPrefilled,
  onChange,
  onClear,
  priceLabel,
  pctLabel,
  tooltip,
}: {
  line:        OrderLine;
  value:       string;
  isPrefilled: boolean;
  onChange:    (v: string) => void;
  onClear:     () => void;
  priceLabel:  string;
  pctLabel:    string | null;
  tooltip:     string | null;
}) {
  const empty = !value.trim();
  return (
    <>
      <Cell><span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMuted }}>{String(line.lineNumber).padStart(2, "0")}</span></Cell>

      <Cell>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.ink }}>{line.buyerItemCode}</span>
      </Cell>

      <Cell>
        <span style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.45 }}>{line.description ?? "—"}</span>
      </Cell>

      <Cell align="right">
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.ink }}>{line.quantity.toLocaleString()}</span>
      </Cell>

      <Cell align="right">
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMuted }}>{priceLabel}</span>
      </Cell>

      <Cell>
        <div
          style={{
            height: 32,
            display: "flex", alignItems: "center", gap: 6,
            border: `1px solid ${empty ? `${T.amber}55` : T.borderStrong}`,
            borderRadius: 6,
            background:    empty ? `${T.amberSoft}88` : T.surface,
            padding: "0 10px",
          }}
        >
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter code…"
            style={{
              flex: 1, border: 0, outline: "none", background: "transparent",
              fontFamily: T.mono, fontSize: 12.5,
              color:    isPrefilled ? T.inkMuted : T.ink,
              fontWeight: 500,
            }}
          />
          {isPrefilled && pctLabel && (
            <SuggestionHint label={pctLabel} tooltip={tooltip} />
          )}
        </div>
      </Cell>

      <Cell>
        <button
          onClick={onClear}
          title="Clear"
          aria-label="Clear supplier code"
          style={{
            width: 26, height: 26, borderRadius: 5,
            background: "transparent", border: 0,
            cursor: "pointer", color: T.inkFaint,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </Cell>
    </>
  );
}

// ─── Cells ───────────────────────────────────────────────────────────────────

function HeadCell({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div style={{
      padding: "11px 14px",
      background: T.surface2,
      borderBottom: `1px solid ${T.border}`,
      fontSize: 10.5, fontWeight: 500,
      textTransform: "uppercase", letterSpacing: "0.08em",
      color: T.inkFaint,
      textAlign: align,
    }}>
      {children}
    </div>
  );
}

function Cell({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div style={{
      padding: "14px",
      borderTop: `1px solid ${T.borderFaint}`,
      display: "flex", alignItems: "center",
      justifyContent: align === "right" ? "flex-end" : "flex-start",
      minHeight: 0,
    }}>
      {children}
    </div>
  );
}

// ─── Suggestion hint — small "✦ 84%" tag inside the input, with tooltip ──────

function SuggestionHint({ label, tooltip }: { label: string; tooltip: string | null }) {
  const node = (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10.5, color: T.inkFaint, fontWeight: 500,
      letterSpacing: "0.04em",
      cursor: tooltip ? "help" : "default",
      whiteSpace: "nowrap",
    }}>
      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 1.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
      </svg>
      {label}
    </span>
  );

  if (!tooltip) return node;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span style={{ fontSize: 11.5 }}>{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}
