"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { Card } from "@/components/bridge/layout/Card";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";
import { useConfirm } from "@/components/ui/confirm";

// Residual constants without a 1:1 design token — kept as literals.
// CODE_GREY (#9196A5) — buyer short-code mono; no exact token.
// BORDER_STRONG (#C6CDDA) — input focus border; no exact token.
// CHEVRON (#A4ADBD) — resting chevron; no exact token.
const CODE_GREY    = "#9196A5";
const BORDER_STRONG = "#C6CDDA";
const CHEVRON      = "#A4ADBD";

const MOCK_BUYERS: BuyerDto[] = [
  { id: "b1", name: "Example Buyer 1", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
  { id: "b2", name: "Example Buyer 2", code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
  { id: "b3", name: "Example Buyer 3", code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
];

// ── Shared cell content (reused by desktop table + mobile cards) ──────────

function BuyerIcon() {
  // building / org glyph in a soft-blue tile — the buyer entity colour
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "var(--brand-blue-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue-deep)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
      </svg>
    </div>
  );
}

function ChannelPill({ label }: { label: string }) {
  // .chip from the design system: surface-2 fill, ink-muted text.
  return (
    <span
      className="chip"
      style={{
        // Render the format label verbatim from the backend (CSV/XLSX/PDF/cXML/EDI/XML).
        color: "var(--ink-muted)",
        background: "var(--surface-2)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SkeletonTrow() {
  const widths = [180, 90, 64, 56, 16];
  return (
    <tr>
      {widths.map((w, i) => {
        // Columns: 0 Buyer (left), 1 Primary format (left), 2 Orders (right),
        // 3 Last order (right), 4 chevron (right).
        const right = i >= 2;
        return (
          <td key={i} style={{ padding: "0 18px", height: 44, borderBottom: "1px solid var(--border-faint)", textAlign: right ? "right" : "left" }}>
            <div
              className="animate-pulse rounded"
              style={{ background: "var(--surface-2)", height: 14, width: w, marginLeft: right ? "auto" : 0 }}
            />
          </td>
        );
      })}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding: "16px 16px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="animate-pulse" style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-2)", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="animate-pulse rounded" style={{ background: "var(--surface-2)", height: 13, width: "60%" }} />
          <div className="animate-pulse rounded" style={{ background: "var(--surface-2)", height: 10, width: 48, marginTop: 7 }} />
        </div>
      </div>
    </div>
  );
}

export default function BuyersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen]   = useState(false);
  const [addName, setAddName]   = useState("");
  const [addCode, setAddCode]   = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["buyers"],
    queryFn:  getBuyers,
    enabled:  !isApiMockMode,
  });

  const buyers: BuyerDto[] = isApiMockMode ? MOCK_BUYERS : (data ?? []);

  const createMut = useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      createBuyer(name, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
      setAddOpen(false);
      setAddName("");
      setAddCode("");
      setAddError(null);
    },
    onError: (err: Error) => {
      setAddError(err.message ?? "Failed to create buyer.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBuyer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  function handleSaveAdd() {
    if (!addName.trim()) { setAddError("Name is required."); return; }
    if (!addCode.trim()) { setAddError("Code is required."); return; }
    setAddError(null);
    createMut.mutate({ name: addName.trim(), code: addCode.trim() });
  }

  const confirm = useConfirm();

  async function handleDelete(e: React.MouseEvent, buyer: BuyerDto) {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete buyer",
      description: `Delete "${buyer.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    deleteMut.mutate(buyer.id);
  }

  const countLabel = isLoading && !isApiMockMode
    ? "Loading…"
    : `${buyers.length} buyer${buyers.length !== 1 ? "s" : ""} · where every order starts`;

  const showSkeleton = isLoading && !isApiMockMode;
  const showError    = isError && !isApiMockMode;
  const showRows     = (!isLoading || isApiMockMode) && !isError;

  return (
    <PageShell variant="wide">
      <PageHeader
        title="Buyers"
        sub={countLabel}
        actions={
          /* New buyer button — primary accent is buyer-blue (design variant="blue") */
          <Button
            variant="blue"
            size="md"
            onClick={() => { setAddOpen((v) => !v); setAddError(null); }}
          >
            {/* plus icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5v14" />
            </svg>
            {addOpen ? "Cancel" : "New buyer"}
          </Button>
        }
      />

      {/* Create buyer panel */}
      {addOpen && (
        <Card className="mb-[18px]">
          {/* Panel header */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: "-0.01em",
                color: "var(--ink)",
              }}
            >
              New buyer
            </div>
            <div style={{ color: "var(--ink-muted)", fontSize: 12.5 }}>
              A buyer that sends you purchase orders
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {/* Buyer name */}
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-muted)",
                  marginBottom: 6,
                }}
              >
                Buyer name <span style={{ color: "var(--danger)", marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: `1px solid ${BORDER_STRONG}`,
                  background: "var(--surface)",
                  fontSize: 13,
                  color: "var(--ink)",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="e.g. Example Buyer Co."
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--brand-blue)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--brand-blue-soft)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_STRONG; e.currentTarget.style.boxShadow = "none"; }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAdd(); }}
              />
            </div>

            {/* Short code */}
            <div className="w-full sm:w-[120px]">
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-muted)",
                  marginBottom: 6,
                }}
              >
                Short code <span style={{ color: "var(--danger)", marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: `1px solid ${BORDER_STRONG}`,
                  background: "var(--surface)",
                  fontSize: 13,
                  fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                  color: "var(--ink)",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="HEIN"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                maxLength={10}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--brand-blue)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--brand-blue-soft)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_STRONG; e.currentTarget.style.boxShadow = "none"; }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAdd(); }}
              />
            </div>

            <Button
              variant="blue"
              size="md"
              onClick={handleSaveAdd}
              disabled={createMut.isPending}
              loading={createMut.isPending}
              className="w-full sm:w-auto"
            >
              {/* check icon */}
              {!createMut.isPending && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              {createMut.isPending ? "Creating…" : "Create buyer"}
            </Button>
          </div>

          {/* Intro note — buyer-blue info callout, matching the design's note style */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "var(--brand-blue-soft)",
              color: "var(--brand-blue-deep)",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            After creating, upload a sample PO and ProcuLink learns the buyer&apos;s layout automatically.
          </div>

          {addError && (
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>{addError}</p>
          )}
        </Card>
      )}

      {/* Table card */}
      <Card className="overflow-hidden !p-0">
        {/* ── Desktop / tablet: data table (sm and up) ─────────────────── */}
        <table className="hidden sm:table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <colgroup>
            <col />
            <col style={{ width: 170 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {([
                { label: "Buyer",            align: "left"  },
                { label: "Primary format",   align: "left"  },
                { label: "Orders (all time)", align: "right" },
                { label: "Last order",       align: "right" },
                { label: "",                 align: "right" },
              ] as const).map((col, i) => (
                <th
                  key={i}
                  // v2 full-bleed table: tinted header band (surface-2) + muted
                  // uppercase labels; 18px left gutter on the first column lines
                  // the label up with the row's leading status dot.
                  style={{
                    textAlign: col.align,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "var(--ink-muted)",
                    background: "var(--surface-2)",
                    padding: "10px 18px",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Skeleton rows while loading */}
            {showSkeleton && (
              <>
                <SkeletonTrow />
                <SkeletonTrow />
                <SkeletonTrow />
              </>
            )}

            {/* Error state in table */}
            {showError && (
              <tr>
                <td
                  colSpan={5}
                  style={{ padding: "32px 16px", textAlign: "center" }}
                >
                  <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    Failed to load buyers.{" "}
                    <button
                      onClick={() => refetch()}
                      style={{
                        color: "var(--brand-blue)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      Retry
                    </button>
                  </span>
                  {error?.message && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-faint)" }}>{error.message}</div>
                  )}
                </td>
              </tr>
            )}

            {/* Buyer rows */}
            {showRows && buyers.map((b, idx) => {
              const isHover = hoverRow === b.id;
              const lastRow = idx === buyers.length - 1;
              // v2 row dividers use the faint border (surface separators), not
              // the stronger card border.
              const cellBorder = lastRow ? "none" : "1px solid var(--border-faint)";
              return (
                <tr
                  key={b.id}
                  onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                  // Keyboard-operable row: the whole row navigates on click, so give
                  // it a button role + tab stop + Enter/Space handler, otherwise
                  // keyboard-only users can't open a buyer at all.
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/inbox?buyer=${b.code}`);
                    }
                  }}
                  aria-label={`Filter inbox to orders from ${b.name}`}
                  title="Filter inbox to orders from this buyer"
                  style={{
                    cursor: "pointer",
                    transition: "background 150ms",
                    background: isHover ? "var(--brand-blue-soft)" : "transparent",
                  }}
                  onMouseEnter={() => setHoverRow(b.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  onFocus={() => setHoverRow(b.id)}
                  onBlur={() => setHoverRow(null)}
                >
                  {/* Buyer: leading blue entity dot + icon tile + name + code */}
                  <td
                    style={{
                      padding: "0 18px",
                      height: 44,
                      borderBottom: cellBorder,
                      fontSize: 12.5,
                      verticalAlign: "middle",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span
                        aria-hidden
                        style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brand-blue)", flexShrink: 0 }}
                      />
                      <BuyerIcon />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)", letterSpacing: "-0.005em" }}>{b.name}</div>
                        <div
                          style={{
                            fontSize: 10.5,
                            fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                            color: CODE_GREY,
                            marginTop: 1,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {b.code}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Primary format — first parsed format, or em-dash if unknown */}
                  <td
                    style={{
                      padding: "0 18px",
                      height: 44,
                      borderBottom: cellBorder,
                      verticalAlign: "middle",
                    }}
                  >
                    {b.formats.length > 0
                      ? <ChannelPill label={b.formats[0]} />
                      : <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>—</span>}
                  </td>

                  {/* Orders (all time) — real backend count, right-aligned, tabular */}
                  <td
                    style={{
                      padding: "0 18px",
                      height: 44,
                      borderBottom: cellBorder,
                      textAlign: "right",
                      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      fontSize: 15,
                      color: "var(--ink)",
                      verticalAlign: "middle",
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.orderCount.toLocaleString()}
                  </td>

                  {/* Last order — relative age from backend, or em-dash */}
                  <td
                    style={{
                      padding: "0 18px",
                      height: 44,
                      borderBottom: cellBorder,
                      textAlign: "right",
                      fontSize: 12.5,
                      color: b.lastOrderAge ? "var(--ink-muted)" : "var(--ink-faint)",
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.lastOrderAge ?? "—"}
                  </td>

                  {/* Chevron (delete revealed on row hover) */}
                  <td
                    style={{
                      padding: "0 14px 0 4px",
                      height: 44,
                      borderBottom: cellBorder,
                      textAlign: "right",
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {/* Delete button — only visible on row hover to keep the resting row clean */}
                      <button
                        onClick={(e) => handleDelete(e, b)}
                        disabled={deleteMut.isPending}
                        title="Delete buyer"
                        aria-label={`Delete ${b.name}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 5,
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                          color: "var(--ink-faint)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                          flexShrink: 0,
                          opacity: isHover ? 1 : 0,
                          pointerEvents: isHover ? "auto" : "none",
                          transition: "opacity 120ms, color 120ms, border-color 120ms",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--danger)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--danger-soft)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-faint)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                      {/* Chevron */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={CHEVRON} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Mobile: stacked row-cards (below sm) ──────────────────────── */}
        <div className="sm:hidden flex flex-col gap-2 p-3">
          {showSkeleton && (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {showError && (
            <div style={{ padding: "28px 16px", textAlign: "center" }}>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                Failed to load buyers.{" "}
                <button
                  onClick={() => refetch()}
                  style={{ color: "var(--brand-blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, padding: 0 }}
                >
                  Retry
                </button>
              </span>
              {error?.message && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-faint)" }}>{error.message}</div>
              )}
            </div>
          )}

          {showRows && buyers.map((b) => (
            <MobileListRow
              key={b.id}
              onClick={() => router.push(`/inbox?buyer=${b.code}`)}
            >
              {/* Top: identity + delete */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <BuyerIcon />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)", letterSpacing: "-0.005em", lineHeight: 1.25 }}>
                    {b.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                      color: CODE_GREY,
                      marginTop: 2,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {b.code}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, b)}
                  disabled={deleteMut.isPending}
                  title="Delete buyer"
                  aria-label={`Delete ${b.name}`}
                  style={{
                    width: 40,
                    height: 40,
                    marginRight: -8,
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    color: "var(--ink-faint)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
                    <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* Stats row: labelled fields in a 2-column grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px 16px",
                  marginTop: 6,
                  paddingLeft: 44, // align under the name, past the icon tile
                }}
              >
                <MobileField label="Primary format">
                  {b.formats.length > 0
                    ? <ChannelPill label={b.formats[0]} />
                    : <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>—</span>}
                </MobileField>
                <MobileField label="Orders (all time)">
                  <span
                    style={{
                      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                      fontWeight: 600,
                      fontSize: 16,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {b.orderCount.toLocaleString()}
                  </span>
                </MobileField>
                <MobileField label="Last order">
                  <span style={{ fontSize: 13, color: b.lastOrderAge ? "var(--ink-muted)" : "var(--ink-faint)" }}>
                    {b.lastOrderAge ?? "—"}
                  </span>
                </MobileField>
              </div>
            </MobileListRow>
          ))}
        </div>

        {/* Empty state */}
        {showRows && buyers.length === 0 && (
          <EmptyState
            title="No buyers yet"
            sub="A buyer is an organization that sends you purchase orders, in whatever format they use."
            action={{ label: "New buyer", onClick: () => setAddOpen(true) }}
          />
        )}
      </Card>
    </PageShell>
  );
}

// Small labelled field used in the mobile stacked card 2x2 grid.
function MobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
