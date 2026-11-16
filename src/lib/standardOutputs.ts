import { STANDARDS } from "@/lib/standards/catalog";

/** The standards a flow output can be. Mirrors `StandardOutputs.All` in the backend; diffed by backendMirror.test.ts. */
export const STANDARD_OUTPUTS = ["cxml-1-2", "ubl-2-1-order", "x12-850", "peppol-bis-billing-3", "peppol-bis-billing-3-credit-note", "edifact-orders", "en16931-cii", "en16931-cii-credit-note", "xrechnung-ubl", "xrechnung-ubl-credit-note", "xrechnung-cii", "xrechnung-cii-credit-note"] as const;

/** The rule set a flagged standard is checked against, as the check button and its result name it. */
const PEPPOL_RULES = { short: "Peppol", long: "Peppol BIS Billing 3.0" };
const EN_RULES = { short: "EN 16931", long: "EN 16931" };
const XR_RULES = { short: "XRechnung", long: "XRechnung 3.0" };
export const RULE_SETS: Record<string, { short: string; long: string }> = {
  "peppol-bis-billing-3": PEPPOL_RULES,
  "peppol-bis-billing-3-credit-note": PEPPOL_RULES,
  "en16931-cii": EN_RULES,
  "en16931-cii-credit-note": EN_RULES,
  "xrechnung-ubl": XR_RULES,
  "xrechnung-ubl-credit-note": XR_RULES,
  "xrechnung-cii": XR_RULES,
  "xrechnung-cii-credit-note": XR_RULES,
};

/** Standards behind the per-org e-invoice (validator sidecar) flag, still named Peppol; offered only when `flow.peppolOn`. */
export const FLAGGED: ReadonlySet<string> = new Set(Object.keys(RULE_SETS));

/** The version the writer writes, where the catalog lists more than one. */
export const WRITTEN_VERSION: Partial<Record<string, string>> = { "x12-850": "004010" };

/** A standard's name from the catalog, else its id. */
export const standardName = (id: string) => STANDARDS.find((s) => s.id === id)?.name ?? id;

/** One line per invoice family, as the standards panel shows it. A family without one shows none. */
const DESCRIPTIONS: Partial<Record<string, string>> = {
  "peppol-bis-billing-3": "The e-invoice format of the Peppol network.",
  "en16931-cii": "The European e-invoice standard, as CII XML.",
  "xrechnung-ubl": "E-invoices for German public bodies, as UBL XML.",
  "xrechnung-cii": "E-invoices for German public bodies, as CII XML.",
};

export type Family = { id: string; name: string; description: string | null; creditNote: string | null; version: string | null };

/** R10: every standard a flow may offer, as families, in catalog order: the invoice families (each with its credit-note
 *  twin) only when `peppolOn`, and the order standards. Nothing in STANDARD_OUTPUTS is dropped. */
export function standardFamilies(peppolOn: boolean | undefined): { invoices: Family[]; orders: Family[] } {
  const offered = STANDARDS.filter((s) => (STANDARD_OUTPUTS as readonly string[]).includes(s.id));
  const family = (id: string, name: string, version: string, creditNote: string | null): Family =>
    ({ id, name, description: DESCRIPTIONS[id] ?? null, creditNote, version: WRITTEN_VERSION[id] ?? version });
  return {
    invoices: peppolOn
      ? offered.filter((s) => FLAGGED.has(s.id) && !s.id.endsWith("-credit-note")).map((s) =>
        family(s.id, s.name.replace(" (invoice)", ""), s.version, FLAGGED.has(`${s.id}-credit-note`) ? `${s.id}-credit-note` : null))
      : [],
    orders: offered.filter((s) => !FLAGGED.has(s.id)).map((s) => family(s.id, s.name, s.version, null)),
  };
}

/** R9: which group of standards fits a flow's documents, from the kind we read; null when not known. */
export const kindGroup = (kindLabel: string | null): "invoices" | "orders" | null =>
  !kindLabel ? null : /credit note|invoice/i.test(kindLabel) ? "invoices" : /order/i.test(kindLabel) ? "orders" : null;
