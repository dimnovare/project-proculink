import { EARLY_ACCESS } from "@/lib/marketing/earlyAccess";
import { FLAGGED, KSEF, STANDARD_OUTPUTS } from "@/lib/standardOutputs";

// What the app's registries hold that /formats does not list, and why. Read by
// src/components/marketing/formatsRows.ts. It lives here, outside components/marketing, because
// its keys are registry ids that name standards, and the public-copy guards scan every word of
// that folder: a key is not a claim, but the guard cannot tell the two apart.

const STANDARD_FILE = "a standard's own file; named only after a real send from a real workspace (decision 7)";
// The order standards are listed on /formats since each had a real send (2026-11-18); the e-invoice ones are held back.
const STANDARD_OUTPUT = "e-invoice standard output: off by default, and named on the site only after a real send (decision 7)";

export const HELD_BACK: Readonly<Record<string, string>> = {
  cxml: STANDARD_FILE,
  edi: STANDARD_FILE,
  x12: STANDARD_FILE,
  outlook: "Microsoft mailbox pickup: behind the native-connectors switch until a real pickup from a real workspace (plan 30)",
  ...Object.fromEntries(STANDARD_OUTPUTS.filter((id) => FLAGGED.has(id) || KSEF.has(id)).map((id) => [id, STANDARD_OUTPUT])),
};

/**
 * Destinations /formats lists in its Early access block, not in the tables: still behind their per-workspace switches.
 * Early access, founder decision 2026-11-26, supersedes decision 7 for these two. The KSeF file and the e-invoice
 * outputs stay in HELD_BACK: the tables still must not list them as file types.
 */
export const EARLY_ACCESS_KEYS: ReadonlySet<string> = new Set(EARLY_ACCESS.items.map((i) => i.key));
