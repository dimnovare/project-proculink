import { STANDARDS } from "@/lib/standards/catalog";

/** The standards a flow output can be. Mirrors `StandardOutputs.All` in the backend; diffed by backendMirror.test.ts. */
export const STANDARD_OUTPUTS = ["cxml-1-2", "ubl-2-1-order", "x12-850", "peppol-bis-billing-3", "peppol-bis-billing-3-credit-note", "edifact-orders", "en16931-cii", "en16931-cii-credit-note", "xrechnung-ubl", "xrechnung-ubl-credit-note", "xrechnung-cii", "xrechnung-cii-credit-note", "factur-x-en16931", "factur-x-en16931-credit-note", "zugferd-xrechnung", "zugferd-xrechnung-credit-note", "ksef-fa-3"] as const;

/** The rule set each e-invoice standard is checked against, as the check button and its result name it. */
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
  "factur-x-en16931": EN_RULES,
  "factur-x-en16931-credit-note": EN_RULES,
  "zugferd-xrechnung": XR_RULES,
  "zugferd-xrechnung-credit-note": XR_RULES,
};

/** E-invoice standards released to every workspace after a real send. Mirrors the backend's unflagged invoice standards. */
export const FACTUR_X = "factur-x-en16931";
const RELEASED = new Set([FACTUR_X]);

/** Standards behind the per-org e-invoice (validator sidecar) flag, still named Peppol; offered only when `flow.peppolOn`. */
export const FLAGGED: ReadonlySet<string> = new Set(Object.keys(RULE_SETS).filter((id) => !RELEASED.has(id)));

/** The Polish KSeF invoice file, behind its own per-org switch; offered only when `flow.ksefOn`. */
export const KSEF: ReadonlySet<string> = new Set(["ksef-fa-3"]);
const INVOICE = (id: string) => id in RULE_SETS || KSEF.has(id);

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
  "factur-x-en16931": "A PDF invoice people can read, with the EN 16931 XML inside.",
  "zugferd-xrechnung": "A PDF invoice for German public bodies, with the XRechnung XML inside.",
  "ksef-fa-3": "The Polish KSeF invoice file (FA(3)). Upload it yourself in the free Aplikacja Podatnika KSeF, or send it with a KSeF destination. You are the issuer; check it before you issue it.",
};

export type Family = { id: string; name: string; description: string | null; creditNote: string | null; version: string | null };

/** R10: every standard a flow may offer, as families, in catalog order: the invoice families (each with its credit-note
 *  twin, when that twin is offered; the flagged ones only when `peppolOn`, the KSeF file only when `ksefOn`), and the order standards. Everything offered is listed once:
 *  a standard that fits no family and is nobody's twin is listed with the order standards. */
export function standardFamilies(peppolOn: boolean | undefined, ksefOn?: boolean): { invoices: Family[]; orders: Family[] } {
  const offered = STANDARDS.filter((s) => (STANDARD_OUTPUTS as readonly string[]).includes(s.id)
    && (peppolOn || !FLAGGED.has(s.id)) && (ksefOn || !KSEF.has(s.id)));
  const has = (id: string) => offered.some((o) => o.id === id);
  const twin = (id: string) => id.endsWith("-credit-note") && has(id.replace(/-credit-note$/, ""));
  const family = (id: string, name: string, version: string, creditNote: string | null): Family =>
    ({ id, name, description: DESCRIPTIONS[id] ?? null, creditNote, version: WRITTEN_VERSION[id] ?? version });
  const invoices = offered.filter((s) => INVOICE(s.id) && !s.id.endsWith("-credit-note"));
  return {
    invoices: invoices.map((s) => family(s.id, s.name.replace(" (invoice)", ""), s.version, has(`${s.id}-credit-note`) ? `${s.id}-credit-note` : null)),
    orders: offered.filter((s) => !invoices.includes(s) && !twin(s.id)).map((s) => family(s.id, s.name, s.version, null)),
  };
}

/** R9: which group of standards fits a flow's documents, from the kind we read; null when not known. Whole words only,
 *  and an answer to an order (a confirmation, an acknowledgement, a response) is not an order. */
export const kindGroup = (kindLabel: string | null): "invoices" | "orders" | null =>
  // An answer to a document (a confirmation, an acknowledgement, a response) is not the document itself.
  !kindLabel || /confirm|acknowledg|response/i.test(kindLabel) ? null
  : /\b(invoices?|credit[- ]notes?)\b/i.test(kindLabel) ? "invoices"
  : /\borders?\b/i.test(kindLabel) ? "orders" : null;
