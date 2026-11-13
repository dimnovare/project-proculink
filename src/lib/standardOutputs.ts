import { STANDARDS } from "@/lib/standards/catalog";

/** The standards a flow output can be. Mirrors `StandardOutputs.All` in the backend; diffed by backendMirror.test.ts. */
export const STANDARD_OUTPUTS = ["cxml-1-2", "ubl-2-1-order", "x12-850", "peppol-bis-billing-3", "peppol-bis-billing-3-credit-note"] as const;

/** Standards behind the per-org Peppol flag; offered only when `flow.peppolOn`. */
export const FLAGGED: ReadonlySet<string> = new Set(["peppol-bis-billing-3", "peppol-bis-billing-3-credit-note"]);

/** The version the writer writes, where the catalog lists more than one. */
export const WRITTEN_VERSION: Partial<Record<string, string>> = { "x12-850": "004010" };

/** A standard's name from the catalog, else its id. */
export const standardName = (id: string) => STANDARDS.find((s) => s.id === id)?.name ?? id;
