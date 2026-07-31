// CHANGELOG APPEND-ONLY GUARD
//
// A changelog is a historical record, and the only property that makes one worth
// reading is that it is append-only. When a feature is retired, the honest move
// is a NEW dated entry saying so. Editing the entry that announced the feature
// would claim it never shipped — a lie about the past, told to tidy up the
// present.
//
// This is not hypothetical here. FE #47 retired five screens whose arrival is
// announced in the v1.0 entry ("validation rules, output templates") and the
// v1.2 entry ("Webhooks"). Those entries are TRUE: those things did ship, on
// those dates. So they are frozen below, byte for byte, and the retirement is
// announced in an entry of its own.
//
// The freeze is ONE contiguous substring on purpose. Every historical entry,
// v1.4 down to v1.0, sits in one unbroken run of the source, so a single
// `includes` proves all five are unchanged AND still in the same order — which
// five per-entry checks would not. It also means a new entry can only go ABOVE
// them, which is what append-only means for a newest-first list.
//
// Source-text assertion rather than an RTL render, matching the house pattern in
// plain-language-copy.test.ts: cheap, and needs no Clerk or query provider.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const CHANGELOG = "src/app/(marketing)/changelog/page.tsx";
/**
 * Line endings are normalised, and ONLY line endings. `core.autocrlf=true` is
 * on for this repo on Windows, so the checkout is CRLF while the committed blob
 * is LF — a byte comparison against a literal would then pass or fail on the
 * reader's git config rather than on the file's content, which is a test that
 * reports the wrong thing in both directions.
 */
const src = readFileSync(join(ROOT, CHANGELOG), "utf8").replace(/\r\n/g, "\n");

/**
 * Every entry that existed before 2026-07-30, verbatim, as the file stood at
 * commit dc445bc. Do not reword, re-punctuate or reformat anything in here. If
 * a change to the product makes one of these lines read wrongly, the remedy is
 * a new entry that says what changed — never a rewrite of the old one.
 */
const HISTORICAL_ENTRIES_V1_4_TO_V1_0 = `  {
    version: "v1.4",
    date: "May 2026",
    latest: true,
    items: [
      "Production UI polish across all screens — mobile-first responsive layouts, empty states, and interaction feedback",
      "IMAP email polling — Integration+ plans now auto-ingest purchase orders from designated mailboxes",
      "ERP connector adapters for Erply and Directo — deliver POs directly to your ERP",
      "Inbound invoices and advance shipping notices — receive and approve supplier documents in one place",
    ],
  },
  {
    version: "v1.3",
    date: "April 2026",
    latest: false,
    items: [
      "PDF ingestion — text-based PDF purchase orders now accepted alongside CSV and XLSX",
      "AI mapping suggestions — unresolved line items now show AI-suggested supplier codes with confidence scores",
    ],
  },
  {
    version: "v1.2",
    date: "March 2026",
    latest: false,
    items: [
      "Supplier delivery configuration — HTTP delivery with test-fire, encrypted credentials, retry logic",
      "PO field mapping engine — custom per-supplier CSV column mapping with visual editor",
      "Webhooks — register HTTP endpoints to receive real-time delivery events",
    ],
  },
  {
    version: "v1.1",
    date: "February 2026",
    latest: false,
    items: [
      "Stripe billing — Growth, Operations, and Integration plans with self-serve Checkout and Portal",
      "Audit log — full event history for every order",
      "Connectors page — overview of all active delivery channels",
    ],
  },
  {
    version: "v1.0",
    date: "January 2026",
    latest: false,
    items: [
      "Initial release: parse → validate → review → transform → deliver workflow",
      "Supplier library, item mappings, validation rules, output templates",
      "Multi-tenant with Clerk auth, EF Core + Postgres",
    ],
  },`;

const HISTORY_AT = src.indexOf(HISTORICAL_ENTRIES_V1_4_TO_V1_0);
/** Everything above the frozen run — i.e. whatever has been appended since. */
const appended = () => src.slice(0, HISTORY_AT);

describe("changelog is append-only", () => {
  it("keeps every pre-2026-07-30 entry byte-identical, in order", () => {
    expect(
      HISTORY_AT,
      "An entry that already shipped was edited, reordered or reformatted in " +
        CHANGELOG +
        ". A changelog records what was true on a date; when something stops being " +
        "true, add a new entry saying so.",
    ).toBeGreaterThan(-1);
  });

  it("announces the FE #47 retirements in a new entry, not by editing the old ones", () => {
    expect(HISTORY_AT).toBeGreaterThan(-1);
    const entry = appended();

    // A dated entry of its own, above everything it supersedes (newest-first).
    expect(entry).toContain('version: "v1.5"');
    expect(entry).toContain('date: "July 2026"');

    // It names every retired surface. That is the whole point: someone who used
    // one of these screens has to be able to find out where it went.
    for (const surface of ["Output templates", "Validation rules", "Drafts", "Upload preview"]) {
      expect(entry, `the retirement entry must name "${surface}"`).toContain(surface);
    }

    // …and gives the forwarding address for each capability that still exists.
    // "Retired" with no forwarding address helps nobody.
    expect(entry).toContain("delivery configuration");
    expect(entry).toContain("Validation rules tab");
  });

  it("does not retract the outbound webhooks, which still work", () => {
    expect(HISTORY_AT).toBeGreaterThan(-1);
    const entry = appended();

    // Three different things here are called "webhook" and only the INBOUND
    // ingress was ever vapour. v1.2's "Webhooks — register HTTP endpoints to
    // receive real-time delivery events" is the OUTBOUND one: live, and still
    // true. An entry that just says "webhooks retired" withdraws a working
    // feature by implication, so this one has to name both directions.
    expect(entry).toMatch(/inbound webhook/i);
    expect(entry).toMatch(/outbound webhook/i);
  });

  it("badges the newest entry by position, so appending cannot strand a stale one", () => {
    // The hero read a hardcoded "v1.4 — Latest" and every card colour came from
    // a stored `latest` flag, so appending an entry left the PREVIOUS release
    // wearing the Latest badge and the hero naming the wrong version. Both now
    // derive from position 0. The stored flags survive inside the historical
    // entries only because those bytes are frozen; nothing reads them.
    expect(src).not.toMatch(/v\d+\.\d+ — Latest/);
    expect(src).not.toContain("entry.latest");
  });
});
