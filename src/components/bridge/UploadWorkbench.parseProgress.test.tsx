import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, VERBATIM.
//
// `/upload` fired its progress indicator AFTER the upload response and ticked it
// on a clock:
//
//   PIPELINE_STAGES.forEach((_, i) => {
//     const t = setTimeout(() => setPipelineStage(i), i * STAGE_MS);   // 600ms each
//     timerRefs.current.push(t);
//   });
//   const total = setTimeout(() => {
//     router.push(reviewPath);
//   }, PIPELINE_STAGES.length * STAGE_MS + 200);                       // 2,000ms
//
// with the stage label rendered as `{done ? "✓ " : ""}{stage}`. Nothing polled.
// So the operator watched "✓ Reading file" and "✓ Checking format" appear for
// work no server had reported, and was then routed onward at a fixed 2,000ms
// whether the parse had succeeded, failed, or not begun.
//
// This is the same defect class as the six the v2 audit found — an unknown state
// rendering as a confident success — except manufactured rather than inherited.
//
// WHAT THIS GUARD PINS
//
//   1. No step may report completion unless a server said so. While the upload
//      request is unanswered, no amount of elapsed time may produce a completion
//      mark, a filled bar, or a percentage.
//   2. The redirect may not fire on a timer. Advancing the clock with the server
//      silent must not navigate; resolving the request must, without any clock
//      advance at all.
//   3. The honest-success path still reads as success — so this cannot be passed
//      by making everything look permanently pending. A resolved upload really
//      does open the order.
//
// WHY THERE IS NO PARSE POLL ON THIS SCREEN TO TEST
//
// The parse IS reported from the server, on the screen that owns the order:
// OrderWorkshop.tsx:988 gates `status === "parsing"` behind <ParsingGate>, which
// useOrderReview.ts:167 polls every 3s and parseStall.ts escalates at 2 min
// without ever claiming failure (ParsingGate.test.tsx), and a parse that ends
// `failed` renders <OrderProblemPanel mode="gate"> (OrderWorkshop.tsx:965). A
// second progress surface here is the duplicate WP-08 deleted. What this screen
// owes is to stop lying and hand over promptly, which is what is asserted below.
// ─────────────────────────────────────────────────────────────────────────────

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/upload",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getSuppliers: vi.fn(),
  getOrders: vi.fn(),
  detectFormat: vi.fn(),
  uploadPurchaseOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  // Declared inside the factory: vi.mock is hoisted above every top-level
  // binding in this file, so a class defined outside would be in its temporal
  // dead zone by the time the component imports it.
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body?: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
  getBillingStatus: () =>
    Promise.resolve({ canProcessOrders: true, isTrialExpired: false, plan: "growth" }),
  // useOrderDirection reads this; the outbound default is what "supplier" copy needs.
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));

import { UploadWorkbench } from "./UploadWorkbench";

// ── The outcome set this guard exercises ─────────────────────────────────────
//
// Three, and only three, things the upload request can be doing when the screen
// is inspected. The floor below asserts the set is this size and that every
// member was actually reached, so a suite that quietly stopped covering one of
// them fails instead of shrinking silently.
const UPLOAD_OUTCOMES = ["unanswered", "created-an-order", "refused"] as const;
type UploadOutcome = (typeof UPLOAD_OUTCOMES)[number];

const exercised = new Set<UploadOutcome>();
function record(outcome: UploadOutcome) {
  exercised.add(outcome);
}

const SUPPLIER: Supplier = {
  id: "sup-1",
  name: "BoltWorks BV",
  code: "BOLT",
  status: "active",
} as Supplier;

/** A promise whose settlement this test controls — i.e. a server that answers when told to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function csv(name = "purchase-order.csv") {
  return new File(["po,qty\nA-1,2\n"], name, { type: "text/csv" });
}

/** Mount the workbench with one supplier already selectable and one file chosen. */
async function mountWithFile() {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  // Format detection is a pre-upload hint and is deliberately left unanswered:
  // it must not be able to stand in for parse progress.
  api.detectFormat.mockReturnValue(new Promise(() => {}));

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(api.getSuppliers).toHaveBeenCalled());

  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  await act(async () => {
    fireEvent.change(input, { target: { files: [csv()] } });
  });

  return view;
}

/** The primary CTA in the action footer. */
function uploadButton(): HTMLButtonElement {
  const el = screen
    .getAllByRole("button")
    .find((b) => /upload|send/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
  if (!el) throw new Error("no upload CTA rendered");
  return el;
}

// ── What counts as claiming a step finished ─────────────────────────────────
//
// Split into a body-wide half and a panel-scoped half ON PURPOSE. The body-wide
// patterns cannot mean anything but a progress claim; the completion VOCABULARY
// is scoped to the progress region, because this screen legitimately says
// "12 KB ready to send" about the file the operator picked
// (UploadWorkbench.tsx:1275) and "Ready" about the plan's processing state
// (:1100). Neither is a claim about the server, and a body-wide `\bready\b`
// fails on both — a guard that cries wolf gets loosened, and a loosened guard
// catches nothing.

/** A finished-step mark. "✓" is the literal the deleted labels used: `{done ? "✓ " : ""}{stage}`. */
const COMPLETION_MARK = /✓|✔|☑/;

/** A measured claim. Nothing here measures a fraction or a time-to-go, so nothing may print one. */
const MEASURED_CLAIM =
  /\b\d{1,3}\s?%|\b\d+\s*(?:seconds?|secs?|minutes?|mins?)\s*(?:left|remaining|to go)\b|\bETA\b/i;

/** The three fabricated stage names, verbatim. */
const DELETED_STAGES = /reading file|checking format|preparing review/i;

/** Completion vocabulary — only unambiguous inside the progress region. */
const COMPLETION_WORD = /\bcomplete[d]?\b|\bdone\b|\bfinished\b|\bready\b|\bparsed\b|\bextracted\b/i;

function inFlightPanel(): HTMLElement {
  const el = screen.getByTestId("upload-in-flight");
  return el;
}

beforeEach(() => {
  push.mockReset();
  api.getSuppliers.mockReset();
  api.getOrders.mockReset();
  api.detectFormat.mockReset();
  api.uploadPurchaseOrder.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UploadWorkbench — upload progress is the server's, not a clock's", () => {
  it("claims no completed step, and does not navigate, while the server has not answered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountWithFile();

    const server = deferred<{ order: { id: string } }>();
    api.uploadPurchaseOrder.mockReturnValue(server.promise);

    await act(async () => {
      fireEvent.click(uploadButton());
    });

    // FLOOR — the in-flight state really rendered. Every negative assertion below
    // is about THIS element; without it they would all pass against a blank
    // screen, which is the vacuous way to satisfy "nothing claims completion".
    const panel = inFlightPanel();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("data-upload-state", "uploading");
    expect(panel.textContent ?? "").toMatch(/uploading purchase-order\.csv/i);
    record("unanswered");

    // The old ladder had ticked two steps green by 1,200ms and navigated at
    // 2,000ms. Run well past all of it, repeatedly, with the server still silent.
    for (let elapsed = 0; elapsed < 30_000; elapsed += 500) {
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(
        push,
        `navigated at ${elapsed + 500}ms with the upload still unanswered — the redirect is on a timer`,
      ).not.toHaveBeenCalled();
    }

    // Nothing anywhere on the screen ticks a step, prints a fraction, or promises
    // a time — after thirty seconds of elapsed clock and zero server words.
    const body = document.body.textContent ?? "";
    expect(
      body.match(COMPLETION_MARK)?.[0] ?? null,
      "a completed-step mark rendered while the server had reported nothing",
    ).toBeNull();
    expect(
      body.match(MEASURED_CLAIM)?.[0] ?? null,
      "a percentage or an ETA rendered, and nothing on this screen measures either",
    ).toBeNull();
    expect(
      body.match(DELETED_STAGES)?.[0] ?? null,
      "a fabricated stage name is back on the screen",
    ).toBeNull();

    // …and the progress region itself claims nothing finished.
    expect(
      (panel.textContent ?? "").match(COMPLETION_WORD)?.[0] ?? null,
      "the in-flight panel used completion vocabulary for work no server had confirmed",
    ).toBeNull();

    // Leave the promise settled so the pending act() queue drains cleanly.
    await act(async () => {
      server.resolve({ order: { id: "ord-drain" } });
    });
  });

  it("opens the order the moment the upload resolves — without advancing the clock", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountWithFile();

    const server = deferred<{ order: { id: string } }>();
    api.uploadPurchaseOrder.mockReturnValue(server.promise);

    await act(async () => {
      fireEvent.click(uploadButton());
    });

    // FLOOR — the upload was genuinely attempted, so "push was called" below is
    // about this upload and not about some unrelated render-time navigation.
    expect(api.uploadPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      server.resolve({ order: { id: "ord-77 a/b" } });
    });
    record("created-an-order");

    // No advanceTimersByTime between the answer and the assertion: if the push
    // were still scheduled, this is where it would fail.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/inbox/ord-77%20a%2Fb");
  });

  it("keeps the operator here, told why, when the server refuses the upload", async () => {
    await mountWithFile();

    // A plain Error, not an ApiHttpError: this is the non-429 arm, the one that
    // routes through describeUploadFailure.
    api.uploadPurchaseOrder.mockRejectedValue(new Error("Upload failed: HTTP 500"));

    await act(async () => {
      fireEvent.click(uploadButton());
    });

    // FLOOR — a refusal really was surfaced. Asserting "did not navigate" against
    // a screen that silently swallowed the error would pass and mean nothing.
    await waitFor(() => {
      expect(screen.queryByTestId("upload-in-flight")).not.toBeInTheDocument();
    });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/couldn't|could not|failed|try again/i);
    record("refused");

    // A refused upload created no order, so there is nothing to open.
    expect(push).not.toHaveBeenCalled();
  });

  // ── Anti-vacuity floor ──────────────────────────────────────────────────────
  //
  // Declared last so it runs after the three above. It fails both ways: if an
  // outcome stops being exercised, and if the declared set is quietly trimmed to
  // match a suite that covers less.
  it("exercised every declared upload outcome", () => {
    expect(UPLOAD_OUTCOMES.length).toBe(3);
    expect([...exercised].sort()).toEqual([...UPLOAD_OUTCOMES].sort());
  });
});
