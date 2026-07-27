"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { Supplier } from "@/types/procurement";

/* =====================================================================
   SupplierIdentityCard — the supplier's own identifiers.

   These are the right-hand side of supplier auto-detect: when a document
   arrives with no resolvable supplier, the numbers printed on it are
   compared against these. Filling them in is the single highest-value
   thing an operator can do to make routing work, so the card says so
   plainly rather than leaving four unexplained inputs on a form.

   PATCH SEMANTICS: PUT /api/suppliers/{id} treats a null identity field as
   "leave it as it is" and an empty string as "clear it". This form always
   sends strings — never null — so what the operator sees is what gets
   stored, and clearing a field actually clears it.
   ===================================================================== */

const INK = "#0B1A2F";
const MUTED = "#5E6779";
const FAINT = "var(--ink-faint)";
const LINE = "#E5E8EE";
const SURFACE = "#FFFFFF";
const BLUE = "#1E66C9";
const GREEN_DEEP = "#1E6D29";
const DANGER = "#B43838";

type IdentityDraft = {
  vatNumber: string;
  registrationNumber: string;
  ediCode: string;
  primaryDomain: string;
};

const FIELDS: Array<{ key: keyof IdentityDraft; label: string; hint: string; placeholder: string }> = [
  {
    key: "vatNumber",
    label: "VAT number",
    hint: "As registered, e.g. EE101234567.",
    placeholder: "EE101234567",
  },
  {
    key: "registrationNumber",
    label: "Registration number",
    hint: "Company registry code.",
    placeholder: "12345678",
  },
  {
    key: "ediCode",
    label: "EDI / GLN code",
    hint: "GLN, ILN or Peppol participant id.",
    placeholder: "5412345000176",
  },
  {
    key: "primaryDomain",
    label: "Primary domain",
    hint: "The domain they send email from. Stored without http:// or www.",
    placeholder: "acme.com",
  },
];

export function SupplierIdentityCard({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const { labels } = useOrderDirection();
  const partyNounLower = labels.counterpartyNoun.toLowerCase();
  const queryEnabled = useQueriesEnabled();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    enabled: isApiMockMode || queryEnabled,
  });

  const supplier = suppliers?.find(s => s.id === supplierId) ?? null;

  const save = useMutation({
    mutationFn: (draft: IdentityDraft) =>
      apiClient.renameSupplier(supplierId, {
        // Name is required by the API and this card does not edit it — send the
        // current one back untouched rather than inventing a value.
        name: supplier!.name,
        vatNumber: draft.vatNumber.trim(),
        registrationNumber: draft.registrationNumber.trim(),
        ediCode: draft.ediCode.trim(),
        primaryDomain: draft.primaryDomain.trim(),
      }),
    onSuccess: (updated) => {
      // Write the SERVER's copy back, not the draft: the backend normalises the
      // domain, so showing the typed value would show something that isn't stored.
      qc.setQueryData<Supplier[]>(["suppliers"], (prev) =>
        (prev ?? []).map(s => (s.id === updated.id ? { ...s, ...updated } : s)),
      );
      setNotice({ kind: "ok", text: "Saved." });
    },
    onError: (err: Error) => {
      setNotice({ kind: "error", text: err.message || `Could not save this ${partyNounLower}.` });
    },
  });

  // Nothing to bind to (a supplier the list doesn't have) — render nothing rather
  // than an empty form whose Save would 404.
  if (!supplier) return null;

  const storedKey = [
    supplier.name,
    supplier.vatNumber ?? "",
    supplier.registrationNumber ?? "",
    supplier.ediCode ?? "",
    supplier.primaryDomain ?? "",
  ].join("|");

  return (
    <div style={{ background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
      <div className="px-5 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
        <h3 className="text-[13px] font-semibold" style={{ color: INK }}>Identifiers</h3>
        <p className="mt-1 text-[12px]" style={{ color: MUTED, lineHeight: 1.5 }}>
          Used to recognise documents from this {partyNounLower}. When an order arrives without a
          named {partyNounLower}, we compare the numbers printed on it against these. Leave any of
          them blank if you don&rsquo;t have it.
        </p>
      </div>

      <IdentityForm
        key={storedKey}
        supplier={supplier}
        saving={save.isPending}
        onSave={(draft) => { setNotice(null); save.mutate(draft); }}
      />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 pb-4 text-[12.5px] font-semibold sm:px-5"
          style={{ color: notice.kind === "error" ? DANGER : GREEN_DEEP }}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}

/**
 * Remounted (via `key`) whenever the STORED values change, so the inputs always
 * reflect what the API actually holds — including the server-normalised domain
 * after a save — without an effect syncing props into state.
 */
function IdentityForm({
  supplier,
  saving,
  onSave,
}: {
  supplier: Supplier;
  saving: boolean;
  onSave: (draft: IdentityDraft) => void;
}) {
  const [draft, setDraft] = useState<IdentityDraft>({
    vatNumber: supplier.vatNumber ?? "",
    registrationNumber: supplier.registrationNumber ?? "",
    ediCode: supplier.ediCode ?? "",
    primaryDomain: supplier.primaryDomain ?? "",
  });

  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {FIELDS.map(({ key, label, hint, placeholder }) => {
          const inputId = `supplier-identity-${key}`;
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={inputId} className="text-[12px] font-semibold" style={{ color: INK }}>
                {label}
              </label>
              <input
                id={inputId}
                type="text"
                value={draft[key]}
                placeholder={placeholder}
                onChange={(e) => setDraft(d => ({ ...d, [key]: e.target.value }))}
                className="w-full text-[12.5px]"
                style={{
                  minHeight: 36, padding: "8px 10px", borderRadius: 7,
                  border: `1px solid ${LINE}`, color: INK, background: SURFACE,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              />
              <span className="text-[11.5px]" style={{ color: FAINT, lineHeight: 1.4 }}>{hint}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="inline-flex items-center justify-center text-[12.5px] font-semibold"
          style={{
            minHeight: 36, padding: "8px 16px", borderRadius: 7, border: "none",
            background: saving ? "#C9CFDA" : BLUE, color: "#FFFFFF",
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default SupplierIdentityCard;
