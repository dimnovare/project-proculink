import { FLAGGED, STANDARD_OUTPUTS } from "@/lib/standardOutputs";

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
  ...Object.fromEntries(STANDARD_OUTPUTS.filter((id) => FLAGGED.has(id)).map((id) => [id, STANDARD_OUTPUT])),
};
