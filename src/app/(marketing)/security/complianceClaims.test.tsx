import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// /security — the Compliance table asserted a legal conclusion it had nothing behind.
//
// THE DEFECT THIS PINS, verbatim:
//
//     const COMPLIANCE_ROWS: Array<[string, string]> = [
//       ["GDPR", "Compliant · DPA available"],
//       ["SOC 2", "Readiness on our roadmap"],
//       ["ISO 27001", "On our roadmap"],
//     ];
//
// "Compliant" is a VERDICT about ProcuLink under the GDPR. No audit, attestation,
// assessment or supervisory finding exists in either repo, and the regulation has no
// certification a product can hold — so the word was a bare self-assertion, sitting in the
// same three-row card as two rows ("Readiness on our roadmap", "On our roadmap") that are
// careful in exactly the way it was not.
//
// The replacement states ARTIFACTS a reader can reach instead: the DPA is published in full
// at /dpa (Art. 28 terms, Annexes I–III, footer-linked from this page), and SCCs
// (Commission Implementing Decision 2021/914) cover extra-EEA transfers per DPA §4.
//
// The negative sweep runs over the OTHER two rows as well, deliberately. A "fix" that
// simply deleted the GDPR row, or that hedged the whole table into saying nothing, would
// satisfy the verdict half on its own — so the roadmap rows are pinned as still present and
// still hedged, and the GDPR row is pinned as still naming GDPR.

import SecurityPage from "./page";

/** Legal conclusions this page may not assert about itself without an artifact behind it. */
const VERDICT_WORD =
  /\b(compliant|compliance|certified|certification|accredited|attested|attestation|audited|conformant|conformance|conforms?|validated|guaranteed|approved)\b/i;

/** The claim that is false on the normal path — OpenAI and Postmark are US, and named as such. */
const EU_PROCESSING =
  /\beu processing\b|\bprocess(?:ed|ing)\b[^.]{0,40}\bin the (?:eu|eea)\b|\bdata (?:is |are )?processed[^.]{0,40}\beurope\b/i;

/** The standard the fix is about. */
const THE_ROW = "GDPR";

/** The two rows that were already careful, and must stay that way. */
const HEDGED_ROWS = ["SOC 2", "ISO 27001"];

afterEach(cleanup);

/**
 * The Compliance card's rows, read off the DOM.
 *
 * Located by the column heading rather than by a nth-child index: `ListCard` renders the
 * Subprocessors column with the identical `.sec-list-row` markup, and a positional selector
 * would silently start reading the wrong card the day the columns are reordered.
 */
function complianceRows(): Array<{ label: string; note: string }> {
  render(<SecurityPage />);
  const heading = Array.from(document.querySelectorAll("h2.sec-col-title")).find(
    (h) => (h.textContent ?? "").trim().toLowerCase() === "compliance",
  );
  if (!heading?.parentElement) throw new Error("/security has no Compliance column");
  return Array.from(heading.parentElement.querySelectorAll<HTMLElement>(".sec-list-row")).map(
    (row) => {
      const spans = row.querySelectorAll("span");
      return {
        label: (spans[0]?.textContent ?? "").trim(),
        note: (spans[1]?.textContent ?? "").trim(),
      };
    },
  );
}

function rowFor(label: string): { label: string; note: string } {
  const rows = complianceRows();
  // Anti-vacuity: an empty card would satisfy every `not.toMatch` below for free, and the
  // page still rendering is not evidence that this card did.
  expect(rows.length, "the Compliance card rendered no rows — every assertion here is vacuous")
    .toBeGreaterThanOrEqual(3);
  const row = rows.find((r) => r.label.toUpperCase() === label.toUpperCase());
  if (!row) throw new Error(`the Compliance card has no ${label} row (found: ${rows.map((r) => r.label).join(", ")})`);
  expect(row.note.length, `the ${label} row says nothing at all`).toBeGreaterThan(4);
  return row;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE DEFECT — a legal verdict with no artifact behind it.
// ═════════════════════════════════════════════════════════════════════════════

describe("the GDPR row states artifacts, not a verdict", () => {
  it("still names GDPR — the row was not deleted to satisfy the rest of this file", () => {
    expect(rowFor(THE_ROW).label.toUpperCase()).toBe("GDPR");
  });

  it("asserts no legal conclusion about ProcuLink", () => {
    const { note } = rowFor(THE_ROW);
    expect(
      note,
      `the GDPR row asserts a legal conclusion ("${note}") that nothing in this repo substantiates`,
    ).not.toMatch(VERDICT_WORD);
  });

  it("names the DPA, which is published in full at /dpa", () => {
    expect(rowFor(THE_ROW).note).toMatch(/\bDPA\b/);
  });

  it("names the transfer mechanism, which DPA §4 really applies", () => {
    expect(rowFor(THE_ROW).note).toMatch(/\bSCCs?\b|standard contractual clauses/i);
  });

  it("does not claim EU processing — OpenAI and Postmark take order content in the US", () => {
    // Storage residency belongs to the "Where your data lives" card, which states the
    // storage-versus-route split honestly. Repeating a stronger version of it in a
    // compliance table is the shape of the original defect.
    expect(rowFor(THE_ROW).note).not.toMatch(EU_PROCESSING);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTROL — the rest of the table is unchanged and still hedged.
// ═════════════════════════════════════════════════════════════════════════════

describe("the rows that were already honest keep their wording", () => {
  it.each(HEDGED_ROWS)("the %s row still says roadmap and claims nothing", (label) => {
    const { note } = rowFor(label);
    expect(note, `the ${label} row stopped hedging`).toMatch(/roadmap/i);
    expect(note, `the ${label} row grew a verdict`).not.toMatch(VERDICT_WORD);
  });

  it("every row in the card says something, so the table was not hollowed out", () => {
    const rows = complianceRows();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.label.length, "a compliance row lost its standard name").toBeGreaterThan(1);
      expect(row.note.length, `the ${row.label} row lost its text`).toBeGreaterThan(4);
      expect(row.note, `the ${row.label} row asserts a verdict`).not.toMatch(VERDICT_WORD);
    }
  });
});
