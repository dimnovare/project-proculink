import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order } from "@/types/procurement";
import { ConfirmProvider } from "@/components/ui/confirm";
import { PRODUCTION_404_ATTEMPT_MESSAGE, PRODUCTION_404_ERROR_MESSAGE } from "./productionDefectStrings";

/**
 * The panel must ACTUALLY route the supplier's body through supplierReasonText.
 *
 * The unit tests next door pin the function. They do not pin that anything calls it — bypassing the
 * call in OrderProblemPanel left all of them green, which is the exact defect class this repo keeps
 * finding. This file renders the panel and asserts on what reaches the screen, so deleting the call
 * turns it red.
 *
 * Source: `docs/qa/2026-08-01-wp-39-authenticated-production-pass.md` §4.4 — a live 404 whose body
 * was an HTML error page was shown to the operator as the reason their order failed.
 */

const api = {
  getOrderPassport: vi.fn(),
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  transformOrder: vi.fn(),
  retryDelivery: vi.fn(),
  getOrderById: vi.fn(),
  requeueDelivery: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    markDelivered: (...a: unknown[]) => api.markDelivered(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    retryDelivery: (...a: unknown[]) => api.retryDelivery(...a),
    getOrderById: (...a: unknown[]) => api.getOrderById(...a),
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
  },
  requeueDelivery: (...a: unknown[]) => api.requeueDelivery(...a),
  getOpsHealth: vi.fn().mockResolvedValue({ workerHealthy: true }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { OrderProblemPanel } from "../OrderProblemPanel";

const REJECTED = {
  id: "ord-rej-1",
  poNumber: "PO-90210",
  status: "rejected_by_supplier",
  supplierId: "sup-9",
  supplierName: "Nordmark",
  currency: "EUR",
  orderDate: "2026-08-01",
  lines: [],
  artifacts: [],
  errorMessage: null,
} as unknown as Order;

function renderWithReason(rejectionReason: string) {
  api.getOrderPassport.mockResolvedValue({ supplierResponse: { outcome: "rejected", rejectionReason } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderProblemPanel order={REJECTED} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getOrderPassport.mockResolvedValue(null);
});
afterEach(cleanup);

describe("the panel does not show the operator a supplier's markup", () => {
  it("renders the readable text from an HTML error page, never the tags", async () => {
    renderWithReason(
      "<!DOCTYPE html><html><head><title>404 Not Found</title></head>" +
        "<body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
    );

    // The sentence inside survives.
    expect(await screen.findByText(/requested URL was not found/i)).toBeTruthy();

    // The markup does not. document.body.textContent is what a human actually reads.
    const shown = document.body.textContent ?? "";
    expect(shown).not.toContain("<html");
    expect(shown).not.toContain("DOCTYPE");
    expect(shown).not.toContain("<p>");
  });

  it("passes a supplier's plain sentence through unchanged", async () => {
    renderWithReason("Rejected: PO number already received on 2026-07-14.");
    expect(await screen.findByText(/already received on 2026-07-14/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The second door.
//
// Everything above varies `rejectionReason` and leaves `errorMessage: null`, which is exactly
// why the first fix looked complete: `rejectionReason` was the only operand it wrapped, and the
// string production actually showed an operator arrives on the OTHER one. On 2026-08-06 order
// b56ddb85-5b14-4367-bcc1-6f62a391a6a5 (delivery_dead_letter) rendered PRODUCTION_404_ERROR_MESSAGE
// on screen while its passport carried PRODUCTION_404_ATTEMPT_MESSAGE — a sentence written for a
// person — on every attempt.
//
// So these render the real panel with a NON-NULL order.errorMessage and assert on
// document.body.textContent: what a human actually reads, not what a helper returns.
// ─────────────────────────────────────────────────────────────────────────────

const DEAD_LETTER = {
  id: "ord-dl-1",
  poNumber: "PO-4091678643",
  status: "delivery_dead_letter",
  supplierId: "sup-3",
  supplierName: "ProcuLink Sample Supplier",
  currency: "EUR",
  orderDate: "2026-08-01",
  lines: [],
  artifacts: [],
  errorMessage: PRODUCTION_404_ERROR_MESSAGE,
} as unknown as Order;

/** One passport delivery attempt. Only the fields this panel reads are meaningful. */
function attempt(attemptNumber: number, errorMessage: string | null) {
  return {
    attemptNumber,
    status: "failed",
    channel: "https",
    destination: "https://example.invalid/po",
    attemptedAt: `2026-08-0${attemptNumber}T09:00:00Z`,
    responseCode: 404,
    transportAcceptedAt: null,
    rejectionReason: null,
    errorMessage,
    artifactId: null,
    artifactSha256: null,
  };
}

function renderDeadLetter(passport: unknown, order: Order = DEAD_LETTER) {
  api.getOrderPassport.mockResolvedValue(passport);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <OrderProblemPanel order={order} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Everything on screen, as a person reads it. */
const shownText = () => document.body.textContent ?? "";

describe("order.errorMessage — the operand the first fix did not wrap", () => {
  it("never puts the supplier's markup on screen, even with no passport to fall back on", async () => {
    renderDeadLetter({ deliveryAttempts: [] });
    await screen.findByTestId("order-problem-panel");

    const shown = shownText();
    expect(shown).not.toContain("<!DOCTYPE");
    expect(shown).not.toContain("<html");
    expect(shown).not.toContain("<head");
    expect(shown).not.toContain("<!--");
    expect(shown).not.toContain("Accept header");
    // A lead-in with nothing behind it reads as a broken screen.
    expect(shown).not.toContain("Response summary");
  });

  it("keeps what the message did say — the panel loses markup, not information", async () => {
    renderDeadLetter({ deliveryAttempts: [] });
    await screen.findByTestId("order-problem-panel");
    expect(shownText()).toContain("HTTP 404");
  });
});

describe("the sentence written for a person outranks the raw one", () => {
  it("shows the passport attempt's message instead of order.errorMessage", async () => {
    renderDeadLetter({ deliveryAttempts: [attempt(1, PRODUCTION_404_ATTEMPT_MESSAGE)] });

    expect(await screen.findByText(/delivery address in this supplier's delivery settings/i)).toBeTruthy();
    const shown = shownText();
    // Whole, including the half that names the fix — this is why the clamp had to grow.
    expect(shown).toContain("correct it there, then send the order again");
    expect(shown).not.toContain("supplier endpoint returned an error");
  });

  it("takes the LATEST attempt, whichever way round the API returns them", async () => {
    // Nothing in the repo documents whether deliveryAttempts arrives newest- or oldest-first, and
    // the passport screen just reads the last element. An assumption that is never stated is one
    // that silently shows the operator a stale reason, so the panel must not hold one.
    const older = attempt(1, "The supplier's endpoint did not answer in time (HTTP 408).");
    const newer = attempt(2, PRODUCTION_404_ATTEMPT_MESSAGE);

    for (const order of [[older, newer], [newer, older]]) {
      cleanup();
      renderDeadLetter({ deliveryAttempts: order });
      expect(await screen.findByText(/delivery address in this supplier's delivery settings/i)).toBeTruthy();
      expect(shownText()).not.toContain("did not answer in time");
    }
  });

  it("sanitises the attempt message too — it can carry the supplier's body appended", async () => {
    // DescribeFailure appends the supplier's own words to its sentence, so this operand is no
    // more trustworthy than the other two. All three go through the same door.
    renderDeadLetter({
      deliveryAttempts: [
        attempt(1, `${PRODUCTION_404_ATTEMPT_MESSAGE} The supplier's endpoint said: <html><body><h1>404</h1></body></html>`),
      ],
    });
    await screen.findByTestId("order-problem-panel");

    const shown = shownText();
    expect(shown).toContain("delivery address in this supplier's delivery settings");
    expect(shown).not.toContain("<html");
    expect(shown).not.toContain("<h1>");
  });

  it("cleans the third door too — the error a failed recovery POST puts in the alert", async () => {
    // Found by asking, after the fix above, "is there another way a body off the wire reaches
    // prose here?" There is, and it is in this component.
    //
    // api-client.ts:857 builds `error ?? \`${fallback}: ${responseText}\`` — when the body is
    // not JSON with an { error } field, the RAW text is pasted into ApiHttpError.message. A
    // gateway 502 answers with an HTML page, useProblemAction does
    // `setError(err.message)`, and the panel renders it in its role="alert" block. Same defect,
    // different door, one click away from the one production found.
    renderDeadLetter({ deliveryAttempts: [] });
    await screen.findByTestId("order-problem-panel");

    api.requeueDelivery.mockRejectedValue(
      new Error(
        "We couldn't start sending this order: <!DOCTYPE html><html><head>" +
          "<title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1>" +
          "</center></body></html>",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /start sending again/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("<");
    expect(alert.textContent).not.toContain("DOCTYPE");
    // Cleaned, not silenced: the operator still learns what came back.
    expect(alert.textContent).toContain("502");
  });

  it("leaves an ordinary failure message alone", async () => {
    renderDeadLetter({ deliveryAttempts: [] });
    await screen.findByTestId("order-problem-panel");

    api.requeueDelivery.mockRejectedValue(new Error("That order is already being sent."));
    fireEvent.click(screen.getByRole("button", { name: /start sending again/i }));

    expect((await screen.findByRole("alert")).textContent).toBe("That order is already being sent.");
  });

  it("still leads with the supplier's own reason when they gave one", async () => {
    // For rejected_by_supplier the panel's own copy says "Their reason is below". The supplier's
    // words stay first there; the attempt message is OUR sentence about the same refusal.
    api.getOrderPassport.mockResolvedValue({
      supplierResponse: { outcome: "rejected", rejectionReason: "Line 4: item ACM-99 is not in our catalogue." },
      deliveryAttempts: [attempt(1, PRODUCTION_404_ATTEMPT_MESSAGE)],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <OrderProblemPanel order={REJECTED} />
        </ConfirmProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/ACM-99 is not in our catalogue/i)).toBeTruthy();
    expect(shownText()).not.toContain("delivery address in this supplier's delivery settings");
  });
});
