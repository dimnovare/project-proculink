"use client";

// OrderDetailsDrawer — restores the order-level audit / standards / supplier-response
// surfaces that the old two-mode SpineReview exposed as top-level tabs (Passport /
// Conformance / Response). The v3 Order Workshop is the daily map→validate→send
// surface; these three are SECONDARY, lower-frequency trust/audit views, so they
// live behind one quiet "Details" trigger in the workshop header instead of three
// permanent tabs.
//
// This component owns NO data/mutation logic — it only relocates the TRIGGERS and
// reuses the three existing panels verbatim (OrderPassport / ConformancePanel /
// SupplierResponsePanel), each of which fetches its own data. The panels only mount
// while the drawer is open. A11y pattern matches HistoryDrawer (scrim + outside-click
// + Esc + aria-modal + focus-trap + focus-restore + var(--tap-min)).

import { useEffect, useRef } from "react";
import { OrderPassport } from "../OrderPassport";
import { ConformancePanel } from "../ConformancePanel";
import { SupplierResponsePanel } from "../SupplierResponsePanel";

export type OrderDetailsTab = "passport" | "conformance" | "response";

export interface OrderDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  tab: OrderDetailsTab;
  onTab: (t: OrderDetailsTab) => void;

  orderId: string;
  poNumber: string;
  supplierName: string;
  currency: string;
  status: string;
  errorMessage?: string | null;
  /** From useOrderDirection().labels — "supplier" outbound, "customer" inbound. */
  counterpartyNoun: string;
  /** Seed the conformance profile from the supplier's delivered format (cxml/ubl/x12);
   *  undefined when the format maps to no named profile (the panel then defaults). */
  defaultConformanceFormat?: "cxml" | "ubl" | "x12";
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const TABS: { id: OrderDetailsTab; label: (noun: string) => string }[] = [
  { id: "passport", label: () => "Audit trail" },
  { id: "conformance", label: () => "Standards check" },
  { id: "response", label: (noun) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)} response` },
];

export function OrderDetailsDrawer(props: OrderDetailsDrawerProps) {
  const { open, onClose, tab, onTab, orderId, poNumber, supplierName, currency, status, errorMessage, counterpartyNoun, defaultConformanceFormat } = props;

  const panelRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Capture trigger, move focus in, restore on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const id = window.requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Esc closes; Tab is trapped inside the panel while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Order details for ${poNumber}`}
      aria-modal="true"
      className="motion-reduce:transition-none"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(11,26,47,0.18)",
        display: "flex",
        justifyContent: "flex-end",
        animation: "plk-odd-scrim 180ms ease-out",
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes plk-odd-scrim { from { opacity: 0 } to { opacity: 1 } }
        @keyframes plk-odd-slide { from { transform: translateX(16px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .plk-odd-panel { animation: none !important } }
      `}</style>

      <aside
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="plk-odd-panel"
        style={{
          width: "min(760px, 64vw)",
          background: "#FFFFFF",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 30px rgba(11,26,47,0.12)",
          animation: "plk-odd-slide 200ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Header: title + close */}
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 22px 0", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", margin: 0, lineHeight: 1.2 }}>
              Order details
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#5E6779", lineHeight: 1.4 }}>
              Audit trail, standards check, and {counterpartyNoun} response for{" "}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#1E6D29" }}>{poNumber}</span>
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close order details"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E66C9] rounded"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "#8893A7", padding: 10, minWidth: "var(--tap-min, 44px)", minHeight: "var(--tap-min, 44px)", flexShrink: 0 }}
          >
            ×
          </button>
        </header>

        {/* Sub-tab strip */}
        <div role="tablist" aria-label="Order detail views" style={{ display: "flex", gap: 6, padding: "12px 22px 0", flexShrink: 0, borderBottom: "1px solid #E5E8EE" }}>
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(t.id)}
                style={{
                  appearance: "none",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: "8px 4px",
                  marginBottom: -1,
                  fontSize: 13,
                  fontWeight: active ? 700 : 600,
                  color: active ? "#0B1A2F" : "#5E6779",
                  borderBottom: `2px solid ${active ? "#1E66C9" : "transparent"}`,
                  minHeight: 36,
                }}
              >
                {t.label(counterpartyNoun)}
              </button>
            );
          })}
        </div>

        {/* Body — only the active panel mounts (each fetches its own data). */}
        <div style={{ flex: 1, overflowY: "auto", background: "#F6F7FA" }}>
          {tab === "passport" && (
            <div style={{ padding: "0" }}>
              <OrderPassport orderId={orderId} />
            </div>
          )}

          {tab === "conformance" && (
            <div className="px-4 py-5 sm:px-6">
              <h3 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", marginBottom: 4 }}>
                Supplier rules check
              </h3>
              <p className="text-[12.5px]" style={{ color: "#5E6779", marginBottom: 16 }}>
                Validate the outbound document for{" "}
                <span className="font-mono" style={{ color: "#1E6D29" }}>{poNumber}</span> against a named standards profile.
              </p>
              <ConformancePanel orderId={orderId} supplierName={supplierName} defaultFormat={defaultConformanceFormat} />
            </div>
          )}

          {tab === "response" && (
            <div className="px-4 py-5 sm:px-6">
              <h3 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", marginBottom: 4 }}>
                {counterpartyNoun.charAt(0).toUpperCase() + counterpartyNoun.slice(1)} response
              </h3>
              <p className="text-[12.5px]" style={{ color: "#5E6779", marginBottom: 16 }}>
                What {supplierName} confirmed back for{" "}
                <span className="font-mono" style={{ color: "#1E6D29" }}>{poNumber}</span>.
              </p>
              {status === "rejected_by_supplier" && (
                <div className="mb-4 rounded-[8px] px-4 py-3" style={{ border: "1px solid var(--danger-soft, #FBE3E3)", borderLeft: "3px solid var(--danger, #B43838)", background: "#FFF7F7" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>
                    {counterpartyNoun.charAt(0).toUpperCase() + counterpartyNoun.slice(1)} rejected this order
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: "#5E6779", lineHeight: 1.5 }}>
                    {errorMessage && errorMessage.trim().length > 0
                      ? errorMessage
                      : "The last delivery attempt came back as a rejection. Fix the order or delivery format, then resend."}
                  </p>
                </div>
              )}
              <SupplierResponsePanel orderId={orderId} currency={currency} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default OrderDetailsDrawer;
