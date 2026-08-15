import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// The panel's scope note UNDER-CLAIMED a real check.
//
// THE DEFECT, verbatim. `ConformancePanel.tsx:288-290` said of every format:
//     "Checks the mandatory elements and cardinalities of this profile. Not a full
//      schema validation, and not a certification — validate with your supplier or
//      access point before you rely on it."
// and its rationale comment said "no vendored schema exists in this repo to make
// that claim true for any format". The repo it meant was the FRONTEND. The check
// runs in the backend: `ProcuLink.Transform/Conformance/UblProfileChecker.cs`
// emits `ubl.xsd`, which validates the emitted document against the vendored,
// unmodified OASIS UBL 2.1 Order-2 XSD (`Conformance/Schemas/ubl-2.1/`, SHA-256
// pinned) via `UblSchemaValidator`, and the verdict crosses the wire into this
// panel. UBL content models are ordered `xsd:sequence`es, so that check catches a
// fault — two mandatory elements transposed — that every presence check here
// passes. Denying it gave away the one verdict in the report a third party
// produced. Under-claiming a real check is its own false statement.
//
// It was also too GENEROUS in the other direction, and still is for cXML and X12:
// nothing is vendored for those, and several of their checks assert a constant our
// own transformer just wrote, so a PASS restates our output back to us.
//
// Backend PR 209 (`fix/conformance-report-separates-schema-from-selfcheck`) split
// the downloadable Markdown into "Published schema" / "Self-check" per row. This
// panel is where that same report is read on screen, and its sentence contradicted
// the file its own Download button produces.
//
// WHY THE FORMAT CONSTANT IS NOT THE LAST WORD. Which formats have a vendored
// grammar is a fact about the BACKEND, so a frontend constant naming them is a
// mirror, and mirrors in this repo drift silently in the under-claiming direction
// — which is the defect above, again. So the summary prefers the wire whenever the
// wire says anything, and the two tests at the bottom pin BOTH directions of that
// override. The constant is the fallback for a server that predates the field.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, getConformanceReport: vi.fn(), downloadConformanceReport: vi.fn() };
});

import * as apiClient from "@/lib/api-client";
import type { ConformanceReport, ConformanceCheck, ConformanceFormat } from "@/lib/api-client";
import { ConformancePanel } from "@/components/bridge/ConformancePanel";

const reportMock = vi.mocked(apiClient.getConformanceReport);

/** The blanket sentence this work removed. Pinned verbatim so it cannot come back. */
const STRUCK_BLANKET = "Not a full schema validation";

/** The sentence a format with a vendored grammar must carry. */
const UBL_SCHEMA_CLAUSE = "validated against the OASIS UBL 2.1 Order schema vendored into ProcuLink";
/** The same claim for a format whose artifact this app cannot name — wire-driven only. */
const GENERIC_SCHEMA_CLAUSE = "validated against a published schema vendored into ProcuLink";
/** The sentence a format with NO vendored grammar must carry. */
const NO_SCHEMA_CLAUSE = "No published schema for this format is vendored into ProcuLink";

function selfCheck(code: string, evidence?: string): ConformanceCheck {
  return {
    code,
    severity: "Error",
    passed: true,
    message: `${code} present.`,
    profileRef: `ref/${code}`,
    ...(evidence === undefined ? {} : { evidence }),
  } as ConformanceCheck;
}

function makeReport(format: ConformanceFormat, checks: ConformanceCheck[]): ConformanceReport {
  return {
    orderId: "ord-1",
    format,
    profile: format === "ubl" ? "Ubl21Order" : format === "x12" ? "X12_850" : "Cxml12OrderRequest",
    profileName: `${format.toUpperCase()} profile under test`,
    profileVersion: "1.0",
    overallPass: true,
    errorCount: 0,
    warningCount: 0,
    checks,
  } as ConformanceReport;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function renderPanel(report: ConformanceReport): Promise<string> {
  reportMock.mockResolvedValue(report);
  render(
    <Wrapper>
      <ConformancePanel
        orderId="ord-1"
        supplierName="Nordmark"
        defaultFormat={report.format as ConformanceFormat}
      />
    </Wrapper>,
  );
  // Anti-vacuity: every assertion below reads `textContent`, which is "" on a panel
  // that never rendered. Waiting on the profile name proves the report is on screen.
  await screen.findByText(/profile under test/);
  return document.body.textContent ?? "";
}

beforeEach(() => reportMock.mockReset());
afterEach(() => cleanup());

describe("ConformancePanel scope note — a published schema is not a self-check", () => {
  it("UBL names the vendored OASIS schema check instead of denying schema validation", async () => {
    const text = await renderPanel(makeReport("ubl", [selfCheck("ubl.id"), selfCheck("ubl.xsd")]));

    expect(text).toContain(UBL_SCHEMA_CLAUSE);
    expect(text).not.toContain(STRUCK_BLANKET);
    // The other half of the truth must survive the rewrite: most rows are still ours.
    expect(text).toContain("not independent evidence");
    // And the denial that was always true stays true.
    expect(text).toContain("certification");
  });

  it("cXML says plainly that no published schema is vendored, and names none", async () => {
    const text = await renderPanel(makeReport("cxml", [selfCheck("cxml.id")]));

    expect(text).toContain(NO_SCHEMA_CLAUSE);
    expect(text).not.toContain(UBL_SCHEMA_CLAUSE);
    expect(text).not.toContain(GENERIC_SCHEMA_CLAUSE);
    expect(text).not.toContain(STRUCK_BLANKET);
  });

  it("X12 says plainly that no published schema is vendored, and names none", async () => {
    const text = await renderPanel(makeReport("x12", [selfCheck("x12.beg")]));

    expect(text).toContain(NO_SCHEMA_CLAUSE);
    expect(text).not.toContain(UBL_SCHEMA_CLAUSE);
    expect(text).not.toContain(GENERIC_SCHEMA_CLAUSE);
    expect(text).not.toContain(STRUCK_BLANKET);
  });
});

describe("ConformancePanel per-row evidence class", () => {
  const table = () => within(screen.getByTestId("conformance-checks-table"));
  const cards = () => within(screen.getByTestId("conformance-checks-cards"));

  it("labels every row when the wire carries an evidence class", async () => {
    await renderPanel(
      makeReport("ubl", [
        selfCheck("ubl.id", "SelfCheck"),
        selfCheck("ubl.currency", "SelfCheck"),
        selfCheck("ubl.xsd", "ExternalArtifact"),
      ]),
    );

    // jsdom has no Tailwind, so the desktop table AND the mobile cards both mount.
    // Scope every count, or each label is found twice and the numbers mean nothing.
    expect(table().getByText("Evidence")).toBeTruthy();
    expect(table().getAllByText("Self-check")).toHaveLength(2);
    expect(table().getAllByText("Published schema")).toHaveLength(1);
    expect(cards().getAllByText("Self-check")).toHaveLength(2);
    expect(cards().getAllByText("Published schema")).toHaveLength(1);
  });

  it("shows no evidence column at all when the wire omits the field", async () => {
    // Today's server: `ConformanceCheckDto` has no Evidence member. The panel must
    // say nothing per row rather than derive a class from the check code — a code
    // mirror is the drift this file's header describes.
    await renderPanel(makeReport("ubl", [selfCheck("ubl.id"), selfCheck("ubl.xsd")]));

    expect(table().queryByText("Evidence")).toBeNull();
    expect(table().queryByText("Self-check")).toBeNull();
    expect(table().queryByText("Published schema")).toBeNull();
    expect(cards().queryByText("Self-check")).toBeNull();
    expect(cards().queryByText("Published schema")).toBeNull();
  });

  it("labels nothing for an evidence value it does not recognise", async () => {
    // A future backend class (Schematron, say) must render as no claim — never as
    // the weaker label and never as the stronger one. An unrecognised value falling
    // through to a favourable reading is this repo's most-repeated defect.
    await renderPanel(
      makeReport("ubl", [selfCheck("ubl.id", "SelfCheck"), selfCheck("ubl.sch", "SchematronArtifact")]),
    );

    expect(table().getAllByText("Self-check")).toHaveLength(1);
    expect(table().queryByText("Published schema")).toBeNull();
    expect(table().queryByText("SchematronArtifact")).toBeNull();
  });
});

describe("ConformancePanel scope note prefers the wire over the format constant", () => {
  it("claims a published schema for a non-UBL format when the wire says one ran", async () => {
    const text = await renderPanel(
      makeReport("cxml", [selfCheck("cxml.id", "SelfCheck"), selfCheck("cxml.dtd", "ExternalArtifact")]),
    );

    expect(text).toContain(GENERIC_SCHEMA_CLAUSE);
    expect(text).not.toContain(NO_SCHEMA_CLAUSE);
  });

  it("drops the UBL schema claim when the wire says every row is a self-check", async () => {
    // The direction that matters: if the backend ever stops vendoring the XSD, the
    // frontend constant would keep claiming it. The wire overrules the constant.
    const text = await renderPanel(
      makeReport("ubl", [selfCheck("ubl.id", "SelfCheck"), selfCheck("ubl.currency", "SelfCheck")]),
    );

    expect(text).toContain(NO_SCHEMA_CLAUSE);
    expect(text).not.toContain(UBL_SCHEMA_CLAUSE);
  });
});
