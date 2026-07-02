import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { MobileTriage, type MobileTriageProps } from "./MobileTriage";
import type { WorkshopIssue, IssuesResolveApi } from "./IssuesPanel";
import type { OrderLine } from "@/types/procurement";

afterEach(cleanup);

// ── Long, unbreakable REAL-data tokens (the founder-confirmed overflow case) ──
// A single long word has no spaces to wrap at, so without overflow-wrap it spills
// past the 360px mobile viewport. These mirror genuine German/distributor names,
// long composite SKUs, URLs, and a 200-char description.
const LONG_SUPPLIER =
  "Reichelt-Elektronik-und-Industrievertrieb-Handelsgesellschaft-Sudwestdeutschland-mbH";
const LONG_BUYER = "Beschaffungsabteilung-Zentraleinkauf-Konzernlogistik-Gesamtgesellschaft-Deutschland-AG";
const LONG_SKU = "ABCDEFGH-1234567890-IJKLMNOP-QRSTUVWX-9999";
const LONG_DESCRIPTION =
  "industrial-grade-high-precision-CNC-machined-stainless-steel-flange-coupling-assembly-with-integrated-sealing-gasket-and-corrosion-resistant-coating-suitable-for-high-pressure-hydraulic-systems-XL-9000";
const LONG_URL = "https://supplier-edi-endpoint.example-distribution-network.eu/api/v2/orders/inbound/receive";

const makeLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "l1",
  lineNumber: 1,
  buyerItemCode: "B-1",
  supplierItemCode: null,
  description: "Widget",
  quantity: 1,
  unitPrice: 10,
  confidence: 0,
  needsReview: true,
  ...over,
});

const issue = (over: Partial<WorkshopIssue> & { code: string }): WorkshopIssue => ({
  severity: "blocking",
  ref: over.code,
  title: "Needs a supplier code",
  ...over,
});

const makeProps = (over: Partial<MobileTriageProps> = {}): MobileTriageProps => ({
  poNumber: "PO-DEMO-2026-000001",
  buyerName: LONG_BUYER,
  supplierName: LONG_SUPPLIER,
  grandTotalLabel: "€ 4,436.73",
  status: "pending_review",
  receivedFieldCount: 11,
  lineCount: 1,
  outputFormatLabel: "JSON",
  previewContent: null,
  issues: [],
  blockingIssues: 0,
  exceptionCount: 0,
  canSend: true,
  crossed: false,
  sendState: "idle",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Delivering…",
  doneLabel: "Sent",
  onFix: vi.fn(),
  onFocusField: vi.fn(),
  onSend: vi.fn(),
  ...over,
});

const makeResolve = (over: Partial<IssuesResolveApi> = {}): IssuesResolveApi => ({
  lineEditId: null,
  lineDraft: "",
  setLineDraft: vi.fn(),
  startLineEdit: vi.fn(),
  commitLineCode: vi.fn(),
  cancelLineEdit: vi.fn(),
  confirmFlaggedLine: vi.fn(),
  acceptingLineId: null,
  ...over,
});

// A value element "wraps" when it carries overflow-wrap:anywhere or word-break:break-word.
// jsdom can't lay out, so we assert the wrapping styles are present (the primary gate).
function assertWraps(el: HTMLElement, label: string) {
  const wraps =
    el.style.overflowWrap === "anywhere" ||
    el.style.wordBreak === "break-word" ||
    el.style.wordBreak === "break-all";
  expect(wraps, `${label} must carry overflow-wrap/word-break to wrap a long unbreakable token`).toBe(true);
  // And it must be allowed to shrink inside its flex ancestor (min-width:0, not the
  // default min-width:auto = content width which would force overflow).
  expect(el.style.whiteSpace, `${label} must not be nowrap`).not.toBe("nowrap");
}

describe("MobileTriage — long real-data values wrap (no mobile overflow)", () => {
  test("the header supplier / buyer / total spans wrap a long unbreakable token", () => {
    render(<MobileTriage {...makeProps()} />);
    const header = screen.getByTestId("mobile-triage-header");
    assertWraps(within(header).getByText(LONG_SUPPLIER), "header supplier name");
    assertWraps(within(header).getByText(LONG_BUYER), "header buyer name");
    assertWraps(within(header).getByText("€ 4,436.73"), "header grand total");
  });

  test("the poNumber heading wraps (already hardened — guards the regression)", () => {
    render(<MobileTriage {...makeProps({ poNumber: "PURCHASE-ORDER-NUMBER-WITHOUT-ANY-SPACES-0000000001" })} />);
    const header = screen.getByTestId("mobile-triage-header");
    assertWraps(
      within(header).getByText("PURCHASE-ORDER-NUMBER-WITHOUT-ANY-SPACES-0000000001"),
      "poNumber heading",
    );
  });

  test("the 'What we received' summary VALUE rows wrap (long buyer / SKU-ish values)", () => {
    render(<MobileTriage {...makeProps()} />);
    // The received card defaults closed → open it.
    const card = screen.getByTestId("mobile-card-received");
    fireEvent.click(within(card).getByRole("button", { name: /what we received/i }));
    // The Buyer row value carries the long buyer name.
    assertWraps(within(card).getByText(LONG_BUYER), "received-card buyer value");
  });

  test("issue title and 'why' message wrap a long error string", () => {
    const longWhy =
      `Line 1 value ${LONG_SKU} at ${LONG_URL} did not match any catalog entry for ${LONG_SUPPLIER}.`;
    render(
      <MobileTriage
        {...makeProps({
          issues: [
            issue({
              code: "line:l1",
              kind: "manual-code",
              lineId: "l1",
              title: `No supplier code for ${LONG_DESCRIPTION}`,
              why: longWhy,
            }),
          ],
          blockingIssues: 1,
          lines: [makeLine({ id: "l1", description: LONG_DESCRIPTION })],
        })}
      />,
    );
    const card = screen.getByTestId("mobile-issue-card");
    assertWraps(within(card).getByText(`No supplier code for ${LONG_DESCRIPTION}`), "issue title");
    assertWraps(within(card).getByText(longWhy), "issue why message");
  });

  test("the scroll region keeps overflowX hidden but value elements no longer clip", () => {
    const { container } = render(<MobileTriage {...makeProps()} />);
    // The clipping container the bug report names — still hidden (we did NOT change
    // the layout), but the values inside now wrap rather than getting clipped.
    const scroll = container.querySelector(".plk-mobile-triage > div") as HTMLElement;
    expect(scroll.style.overflowX).toBe("hidden");
    // The supplier value can shrink (min-width:0) so the wrap actually takes effect.
    // jsdom serializes the numeric `0` as "0" (no unit).
    const header = screen.getByTestId("mobile-triage-header");
    expect(within(header).getByText(LONG_SUPPLIER).style.minWidth).toBe("0");
  });

  test("short status / format chips stay nowrap (we did not over-wrap them)", () => {
    render(<MobileTriage {...makeProps({ outputFormatLabel: "cXML" })} />);
    // The 'What we will send' card badge is a short format chip — intentionally nowrap.
    const sendCard = screen.getByTestId("mobile-card-send");
    const badge = within(sendCard).getByText("cXML");
    expect(badge.style.whiteSpace).toBe("nowrap");
  });
});

// The bulk-accept affordance must carry the SAME label as the desktop workshop
// (IssuesPanel / SendReadinessStrip renamed to "Resolve all suggested" in f365aa0;
// mobile was missed). The /upload/preview MagicMappingPreview keeps its own
// "Accept all AI suggestions" — that surface has no issues framing.
describe("MobileTriage — bulk-accept label parity with the desktop workshop", () => {
  test("renders 'Resolve all suggested (N)' and calls bulkAcceptSuggestions(0)", () => {
    const bulkAcceptSuggestions = vi.fn();
    render(
      <MobileTriage
        {...makeProps({
          issues: [issue({ code: "line:l1", kind: "ai-suggestion", lineId: "l1" })],
          blockingIssues: 1,
          lines: [makeLine({ id: "l1" })],
          resolve: makeResolve({ bulkAcceptSuggestions, bulkAccepting: false }),
          suggestableCount: 3,
          highConfCount: 3,
        })}
      />,
    );
    const bulk = screen.getByTestId("mobile-bulk-accept");
    const btn = within(bulk).getByRole("button", { name: /resolve all suggested \(3\)/i });
    fireEvent.click(btn);
    expect(bulkAcceptSuggestions).toHaveBeenCalledWith(0);
    // The pre-f365aa0 label must not reappear on this surface.
    expect(screen.queryByRole("button", { name: /accept all ai suggestions/i })).not.toBeInTheDocument();
  });
});
