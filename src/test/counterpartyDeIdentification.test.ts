/**
 * Counterparty de-identification guard.
 *
 * This repository is PUBLIC. Fixtures, code comments, UI placeholder text, CI
 * logs and commit messages are all world-readable. Party names and network
 * identities copied off a real purchase order are counterparty confidentiality,
 * and once committed they stay reachable in history.
 *
 * ── Why this is an ALLOW-LIST ──────────────────────────────────────────────
 * A deny-list of real company names, committed to a public repository in order
 * to prove that no real company names are committed, republishes exactly what
 * it suppresses — and it would outlive any later scrub of history by sitting in
 * the current tree handing the names back. It also only ever refuses the
 * counterparties somebody thought to list.
 *
 * So: no real value is stored anywhere in order to detect real values. The
 * guard extracts candidates and refuses everything it cannot prove approved.
 * A counterparty nobody has heard of is refused exactly as reliably as a
 * famous one.
 *
 * ── What it CAN detect ────────────────────────────────────────────────────
 * 1. A party name (buyer / supplier / customer / vendor) in a fixture, mock or
 *    component whose words are not in APPROVED_PARTY_TOKENS below. The
 *    vocabulary is closed and reviewed: adding a word is a deliberate diff, and
 *    that diff is the moment somebody gets to ask "did you invent that, or did
 *    you copy it off a real order?".
 * 2. A cXML network identity (`fromIdentity` / `toIdentity` / `senderIdentity`,
 *    including the `placeholder=` shown in the delivery editor) that is not in
 *    the reserved `Example*` form. A really-issued network identity is not
 *    named "Example…", so requiring that prefix states what is permitted
 *    rather than enumerating what is forbidden.
 *
 * ── What it CANNOT detect, and will not pretend to ────────────────────────
 * The allow-list works because these two categories have a closed vocabulary to
 * be allowed against. These do not, and are therefore outside this guard:
 *
 *   • Personal names. No format distinguishes a real person from an invented
 *     one, in either direction.
 *   • Cities, streets, postcodes. A real postcode has the same shape as an
 *     invented one.
 *   • Purchase-order numbers, VAT / registration numbers, GTIN / EAN barcodes,
 *     and EDI / GLN identifiers. No reserved range exists to allow-list
 *     against, unlike the cXML identity where a prefix convention made a
 *     format rule possible.
 *   • Product and model names, which are free text.
 *   • Hostnames and e-mail domains. Reserved-TLD rules (RFC 2606 / ICANN) would
 *     make a guard possible here, but the tree currently carries a live
 *     population of real registrable domains in placeholders and fixtures, so
 *     a guard added today would fail on unrelated files. That is a separate
 *     packet, and its absence is NOT evidence those are clean.
 *   • Party names composed only of generic words already in the vocabulary.
 *
 * Those categories were scrubbed by hand in the packet that added this guard,
 * and a hand-applied convention is precisely the thing that works until
 * somebody forgets once. They are not protected. Do not read this guard
 * passing as evidence that they are clean.
 *
 * ── Withholding ───────────────────────────────────────────────────────────
 * Failure output names file, line and the KIND of leak — never the value. A
 * guard that prints the leak in order to prove the leak exists has not removed
 * it, and this repository's CI logs are public. The file:line already makes it
 * findable locally.
 *
 * ── Self-scan ─────────────────────────────────────────────────────────────
 * This file is itself in the scanned corpus, and its positive controls contain
 * exactly the shapes it refuses. Rather than excluding this path — which would
 * be a hole a future real leak could sit in — every control literal is split
 * across a `+` so that no single SOURCE LINE ever carries a matching pattern,
 * while the assembled string is byte-identical to what it always was.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── The approved placeholder vocabulary ────────────────────────────────────
// NOTHING IN THIS LIST MAY BE A REAL TRADING COUNTERPARTY. Invented party
// names, generic role/sector words, and legal-form suffixes only.
//
// Before adding a word, the question to ask is: "did somebody invent that, or
// did it arrive on a real purchase order?"
const APPROVED_PARTY_TOKENS: ReadonlySet<string> = new Set([
  // Invented party names already in use across the fixtures.
  "acme", "boltworks", "centralis", "electrosupply", "fastparts",
  "globalcomponents", "heinrich", "medicasupply", "nordmark", "northwind",
  "steelhouse", "vanderberg", "westmark",
  // Explicit placeholder vocabulary.
  "example", "demo", "sample", "test", "some", "this", "the",
  // Own product / workspace naming.
  "proculink",
  // Generic role, sector and descriptor words.
  "buyer", "supplier", "components", "distribution", "electronics",
  "industries", "logistics", "logistik", "manufacturing", "metaal", "nordic",
  "pharma", "steel", "steelworks", "tools", "trading", "transit", "tyre", "it",
  // Legal-form suffixes. A suffix says nothing about whether the name in front
  // of it belongs to anybody, so these are allowed on their own merits.
  "ag", "bv", "co", "gmbh", "inc", "oy", "oü",
  // Short code fragments from item-code and id values that the party-field net
  // also catches (e.g. "ACM-BR-55", "HX-4410", "sup-1"). Not party names.
  "acm", "br", "fl", "hx", "nt", "pl", "sup", "s", "b",
  // Tailwind class values assigned to `buyer` / `supplier` keys in the wire
  // topology. Not party names either.
  "bg", "brand", "blue", "green",
]);

/** A cXML network identity is approved only in the reserved `Example*` form. */
const APPROVED_CXML_IDENTITY_PREFIX = "example";

// ── Corpus ─────────────────────────────────────────────────────────────────
// Read from git, never from a filesystem walk. Real customer documents are kept
// untracked precisely so they are not committed, and a filesystem walk would
// flag them; `node_modules` and build output fall out for free.
const SCAN_ROOTS = ["src/", "tests/", "scripts/"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function trackedSourceFiles(root: string): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(
      (f) =>
        SCAN_ROOTS.some((r) => f.startsWith(r)) &&
        SCAN_EXTENSIONS.has(path.extname(f)),
    );
}

// ── Extraction ─────────────────────────────────────────────────────────────
// These helpers are shared by the detectors AND by the anti-vacuity floors, so
// the floor counts exactly what the detector examined. A regex broken into
// matching nothing drives the count to zero and fails loudly, instead of
// reading every byte of 700 files, examining none of them, and turning green.

const PARTY_FIELD =
  /\b(?:buyerName|supplierName|documentSupplierName|customerName|vendorName|partyName|buyer|supplier)\s*:\s*"([^"]*)"/g;

const CXML_IDENTITY_FIELD =
  /\b(?:fromIdentity|toIdentity|senderIdentity)\s*:\s*"([^"]*)"/g;

const CXML_PLACEHOLDER_LINE = /cxml(?:From|To|Sender)Identity/;
const PLACEHOLDER_ATTR = /placeholder="([^"]*)"/g;

/** A GUID-shaped value is an identifier, not a party name. */
const GUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every party-field value on the line. Shared by detector and floor. */
export function partyValuesIn(line: string): string[] {
  return [...line.matchAll(PARTY_FIELD)].map((m) => m[1]);
}

/** Every cXML network identity on the line. Shared by detector and floor. */
export function cxmlIdentitiesIn(line: string): string[] {
  const found = [...line.matchAll(CXML_IDENTITY_FIELD)].map((m) => m[1]);
  if (CXML_PLACEHOLDER_LINE.test(line)) {
    found.push(...[...line.matchAll(PLACEHOLDER_ATTR)].map((m) => m[1]));
  }
  return found;
}

/** Lowercased letters only, Unicode-aware so a non-ASCII name is not erased. */
function normaliseToken(token: string): string {
  return token.replace(/[^\p{L}]/gu, "").toLowerCase();
}

function partyTokens(value: string): string[] {
  if (GUID_SHAPED.test(value.trim())) return [];
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map(normaliseToken)
    .filter(Boolean);
}

const PARTY_VIOLATION = "party name outside the approved placeholder vocabulary";
const CXML_VIOLATION =
  "cXML network identity outside the reserved Example* placeholder form";

/**
 * The violation CLASSES a line produces — the kind of leak, never the value.
 * Exported so the withholding test can drive it directly.
 */
export function violationClasses(line: string): string[] {
  const classes: string[] = [];
  for (const value of partyValuesIn(line)) {
    if (partyTokens(value).some((t) => !APPROVED_PARTY_TOKENS.has(t))) {
      classes.push(PARTY_VIOLATION);
      break;
    }
  }
  for (const identity of cxmlIdentitiesIn(line)) {
    const trimmed = identity.trim();
    if (trimmed && !trimmed.toLowerCase().startsWith(APPROVED_CXML_IDENTITY_PREFIX)) {
      classes.push(CXML_VIOLATION);
      break;
    }
  }
  return classes;
}

type Scan = {
  violations: string[];
  scannedFiles: number;
  scannedBytes: number;
  distinctDirectories: number;
  scannedPartyValues: number;
  scannedCxmlIdentities: number;
};

function sweep(): Scan {
  const root = repoRoot();
  const violations: string[] = [];
  const directories = new Set<string>();
  let scannedFiles = 0;
  let scannedBytes = 0;
  let scannedPartyValues = 0;
  let scannedCxmlIdentities = 0;

  for (const relative of trackedSourceFiles(root)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(root, relative));
    } catch {
      continue; // listed in the index but absent from the worktree
    }
    if (bytes.indexOf(0) >= 0) continue; // binary
    scannedFiles += 1;
    scannedBytes += bytes.length;
    directories.add(path.dirname(relative));

    const lines = bytes.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      scannedPartyValues += partyValuesIn(lines[i]).length;
      scannedCxmlIdentities += cxmlIdentitiesIn(lines[i]).length;
      for (const violationClass of violationClasses(lines[i])) {
        violations.push(`  ${relative}:${i + 1}: ${violationClass}`);
      }
    }
  }

  return {
    violations,
    scannedFiles,
    scannedBytes,
    distinctDirectories: directories.size,
    scannedPartyValues,
    scannedCxmlIdentities,
  };
}

describe("counterparty de-identification", () => {
  it("carries no party name or network identity outside the approved placeholder forms", () => {
    const scan = sweep();
    expect(
      scan.violations,
      "a tracked source file names a party, or a cXML network identity, that this guard "
        + "cannot prove is a placeholder. Replace it with an invented name (and add its words "
        + "to APPROVED_PARTY_TOKENS), or with an Example* identity. This repository and its CI "
        + "logs are PUBLIC, so the offending values are withheld here — the file:line below "
        + "makes each one findable locally:\n"
        + scan.violations.join("\n"),
    ).toEqual([]);
  });

  // ── Anti-vacuity ─────────────────────────────────────────────────────────
  // A file count is NOT a detection floor: the corpus can be enumerated
  // correctly, opened correctly, and still examined by nothing. Four floors,
  // ordered coarse → fine so the first failure names the most upstream cause:
  // the corpus query breaking, the corpus narrowing, the files never being
  // opened, and the extractors themselves matching nothing.
  it("actually reads the source corpus and extracts candidates from it", () => {
    const scan = sweep();

    expect(
      scan.scannedFiles,
      "the corpus query is broken, so the sweep above proves nothing",
    ).toBeGreaterThanOrEqual(400);

    expect(
      scan.distinctDirectories,
      "the corpus has narrowed to a corner of the tree, so the sweep above proves nothing",
    ).toBeGreaterThanOrEqual(40);

    expect(
      scan.scannedBytes,
      "the files were listed but never opened, so the sweep above proves nothing",
    ).toBeGreaterThan(3_000_000);

    // The floors that catch a sweep which reads every byte and examines none of
    // them. Both count via the same helpers the detector calls.
    expect(
      scan.scannedPartyValues,
      `only ${scan.scannedPartyValues} party-field values were extracted across the corpus — `
        + "the party detector matched (almost) nothing, so the sweep above proves nothing",
    ).toBeGreaterThanOrEqual(120);

    expect(
      scan.scannedCxmlIdentities,
      `only ${scan.scannedCxmlIdentities} cXML identities were extracted across the corpus — `
        + "the identity detector matched (almost) nothing, so the sweep above proves nothing",
    ).toBeGreaterThanOrEqual(8);
  });
});

// ── Controls ───────────────────────────────────────────────────────────────
// Every literal below is split across a `+` so no single source line in this
// file carries a pattern the detectors match (see "Self-scan" in the header).
// The assembled strings are what they always were, and these controls going
// green is itself the proof that the split changed no value.

describe("counterparty de-identification — detector controls", () => {
  it.each([
    // A party name whose words are not in the vocabulary. Invented values that
    // merely RESEMBLE the class — the detector needs no knowledge of any real
    // company to refuse them.
    ["buyer" + 'Name: "Inventedsteelworks AG",', PARTY_VIOLATION],
    ["supplier" + 'Name: "Nowhere Tyreworks",', PARTY_VIOLATION],
    ["buyer" + ': "Imaginary Transit AG",', PARTY_VIOLATION],
    ["vendor" + 'Name: "Unlisted Distribution GmbH",', PARTY_VIOLATION],
    // A network identity outside the reserved form.
    ["from" + 'Identity: "Notanexample_SE",', CXML_VIOLATION],
    ["to" + 'Identity: "Someregistry_DE",', CXML_VIOLATION],
    // The production placeholder path: a real-looking identity shipped as
    // placeholder text on a cXML identity input.
    [
      "<input value={cxmlFrom" + 'Identity} placeholder="Notanexample_SE" />',
      CXML_VIOLATION,
    ],
  ])("detects %j", (line, expected) => {
    expect(violationClasses(line)).toContain(expected);
  });

  it.each([
    // Approved party vocabulary, including the values this packet scrubbed to.
    ["buyer" + 'Name: "Example Steelworks AG",'],
    ["supplier" + 'Name: "Example IT Distribution GmbH",'],
    ["buyer" + 'Name: "Example Tyre Co",'],
    ["supplier" + 'Name: "Heinrich Industries GmbH",'],
    ["supplier" + 'Name: "BoltWorks BV",'],
    ["supplier" + 'Name: "ProcuLink Sample Supplier",'],
    // A GUID assigned to a party key is an identifier, not a name.
    ["supplier" + ': "a259e2cc-80cd-4b26-aabf-b7fb73b3b04a",'],
    // Reserved identity form, and the blank / whitespace states the editor uses.
    ["from" + 'Identity: "ExampleBuyer_SE",'],
    ["to" + 'Identity: "ExampleSupplier_SE",'],
    ["to" + 'Identity: "",'],
    ["from" + 'Identity: "   ",'],
    // Decoys: neither is a party field or an identity. The first pairs with the
    // positive control above — the SAME unapproved token stays silent when it is
    // not in a party field, so the detector is scoped rather than blanket.
    ['const label = "Inventedsteelworks naming is fine outside a party field";'],
    ["placeholder=" + '"NetworkId"'],
  ])("stays silent on %j", (line) => {
    expect(violationClasses(line)).toEqual([]);
  });

  it.each([
    ["buyer" + 'Name: "Inventedsteelworks AG",', "Inventedsteelworks"],
    ["supplier" + 'Name: "Nowhere Tyreworks",', "Nowhere"],
    ["from" + 'Identity: "Notanexample_SE",', "Notanexample"],
    [
      "<input value={cxmlFrom" + 'Identity} placeholder="Someregistry_DE" />',
      "Someregistry",
    ],
  ])("withholds the offending value from the violation class (%#)", (line, secret) => {
    const classes = violationClasses(line);

    // MUST come first. `[].every(…)` is true, so a detector broken into
    // returning nothing would make the withholding assertion pass vacuously.
    expect(classes.length, "the line is a leak and must be reported at all").toBeGreaterThan(0);
    expect(
      classes.every((c) => !c.toLowerCase().includes(secret.toLowerCase())),
      "a violation class must name the KIND of leak, never the value — this repository and "
        + "its CI logs are public, and the file:line already makes it findable locally",
    ).toBe(true);
  });
});
