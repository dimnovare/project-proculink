import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderPassport, deriveTimeline } from "@/components/bridge/OrderPassport";
import {
  DELIVERY_ATTEMPT_STATUS_FACTS,
  SENT_ATTEMPT_STATUSES,
  attemptSendWasObserved,
  deliveryAttemptOutcome,
} from "@/lib/deliveryAttemptManifest";
import type { PassportDto, PassportDeliveryAttempt } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// The delivery-attempt status defect, fed back in verbatim.
//
// `OrderPassport` decided "did this reach the supplier?" by POSITIVE SUBSTRING
// MATCH on `PassportDeliveryAttempt.status`, a `string | null` the API sends
// verbatim from the DB:
//
//     s.includes("deliver") || s.includes("success") || s.includes("acknowled")
//       || s === "ok" || s === "sent"
//
// `undeliverable` — the standard SMTP bounce word, and email is one of this
// product's delivery channels — contains "deliver". So did `not_delivered`,
// `delivery_failed` and `delivery_rejected`. Each of them:
//
//   • painted the status word GREEN (#1E6D29), because the row's colour ternary
//     tested success first and only THEN looked for "fail"/"reject";
//   • set `deliveredOk`, forcing `reached = 5`, so all six pipeline nodes drew
//     done/green with a white checkmark and the final node read
//     "Awaiting response — Delivered, no supplier confirmation yet";
//   • flipped the button to "Download what we sent" and the fingerprint caption to
//     "Fingerprint of the file we sent".
//
// And the two predicates disagreed: `s === "sent"` was in the timeline's copy and
// not in the row's, so one screen could draw the timeline green and the row beside
// it amber.
//
// These tests assert the failure, not the fix: they are written against the exact
// strings above and would have failed on the old code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The strings the old matcher read as a completed delivery, none of which is
 * backend vocabulary.
 *
 * `undeliverable` and `not_delivered` are the two the brief names; the other three
 * are here because the same `includes("deliver")` swallowed them, and because
 * `delivery_failed`/`delivery_rejected` say the OPPOSITE of what they rendered as.
 */
const FALSE_POSITIVES = [
  "undeliverable",
  "not_delivered",
  "delivery_failed",
  "delivery_rejected",
  "acknowledgement_failed",
] as const;

/** The three the old matcher accepted outright, and that no backend site writes. */
const NEVER_WRITTEN = ["sent", "ok", "acknowledged"] as const;

const GREEN = "rgb(30, 109, 41)"; // #1E6D29 — reserved for an observed send
const AMBER = "rgb(179, 109, 20)"; // #B36D14 — we cannot tell you
const RED = "rgb(180, 56, 56)"; // #B43838 — it failed

const ARTIFACT_ID = "6f1c9a1e-0000-4000-8000-000000000001";

function attempt(status: string): PassportDeliveryAttempt {
  return {
    attemptNumber: 1,
    status,
    channel: "email",
    destination: "orders@supplier.example",
    attemptedAt: "2026-08-06T09:00:00Z",
    responseCode: null,
    acknowledgedAt: null,
    rejectionReason: null,
    errorMessage: null,
    artifactId: ARTIFACT_ID,
    artifactSha256: "a".repeat(64),
  };
}

/**
 * A passport whose ONLY claim about delivery is the attempt's status.
 *
 * `finalStatus` is `delivering` on purpose: it is a real order status that says the
 * Worker holds the dispatch claim, so it neither advances nor fails the pipeline by
 * itself. `outputArtifact` is present, which takes the pipeline to Transformed (4).
 * Whether it reaches Delivered (5) is therefore decided by the attempt alone.
 */
function passportWith(status: string): PassportDto {
  return {
    order: {
      id: "ord-1",
      poNumber: "PO-4711",
      status: "delivering",
      supplierId: "sup-1",
      supplierName: "Supplier",
      buyerName: "Buyer",
      currency: "EUR",
      orderDate: "2026-08-06",
      createdAt: "2026-08-06T08:00:00Z",
      updatedAt: "2026-08-06T09:00:00Z",
      isSample: false,
    },
    sourceArtifact: { storageKey: "src/po.csv", detectedFormat: "csv" },
    canonical: { lineCount: 3, currency: "EUR", totalValue: 100, totalQuantity: 3 },
    supplierProfile: null,
    validationResults: [],
    mappingDecisions: [],
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: {
      artifactId: ARTIFACT_ID,
      format: "csv",
      fileKey: "out/po.csv",
      createdAt: "2026-08-06T08:45:00Z",
      artifactSha256: "a".repeat(64),
    },
    deliveryAttempts: [attempt(status)],
    supplierResponse: null,
    finalStatus: "delivering",
    timeline: [],
    notes: [],
  };
}

// ── The derivation: does the status advance the pipeline to Delivered? ────────

/** Index of the `Delivered` node in the six-node pipeline. */
const DELIVERED_NODE = 5;

describe("an attempt status must not advance the pipeline to Delivered", () => {
  test.each(FALSE_POSITIVES)("%s does not reach the Delivered node", (status) => {
    const { stages, final } = deriveTimeline(passportWith(status));

    expect(stages[DELIVERED_NODE].label).toBe("Delivered");
    expect(stages[DELIVERED_NODE].state).not.toBe("done");
    // The rendering the defect produced, named exactly so it cannot come back under
    // a different derivation.
    expect(final.label).not.toBe("Awaiting response");
    expect(final.detail).not.toBe("Delivered — no supplier confirmation yet");
  });

  test.each(NEVER_WRITTEN)("%s does not reach the Delivered node either", (status) => {
    const { stages, final } = deriveTimeline(passportWith(status));
    expect(stages[DELIVERED_NODE].state).not.toBe("done");
    expect(final.label).not.toBe("Awaiting response");
  });

  test.each(["dispatching", "unconfirmed"])("%s is an unknown outcome, not a delivery", (status) => {
    // The two states the backend documents as unknowable. Both reach the passport
    // with a real artifact id and no proof anything went out.
    const { stages } = deriveTimeline(passportWith(status));
    expect(stages[DELIVERED_NODE].state).not.toBe("done");
  });

  test("failed does not reach the Delivered node", () => {
    const { stages, final } = deriveTimeline(passportWith("failed"));
    expect(stages[DELIVERED_NODE].state).toBe("failed");
    expect(final.label).toBe("Failed");
  });

  test("success — the ONE status that does — still reaches it", () => {
    // The anti-vacuity pair for every assertion above: a test that only ever proves
    // "nothing is green" passes just as well when nothing renders at all.
    const { stages, final } = deriveTimeline(passportWith("success"));
    expect(stages[DELIVERED_NODE].state).toBe("done");
    expect(final.label).toBe("Awaiting response");
    expect(final.detail).toBe("Delivered — no supplier confirmation yet");
  });

  test("the timeline and the row read the SAME predicate", () => {
    // `s === "sent"` used to be in the timeline's copy of the matcher and not in the
    // row's, so one screen gave two answers. Both now call attemptSendWasObserved.
    for (const status of [...FALSE_POSITIVES, ...NEVER_WRITTEN, "dispatching", "unconfirmed", "failed", "success"]) {
      const advanced = deriveTimeline(passportWith(status)).stages[DELIVERED_NODE].state === "done";
      expect(advanced, `timeline and row disagree about "${status}"`).toBe(attemptSendWasObserved(status));
    }
  });
});

// ── The manifest: unknown is never a success ─────────────────────────────────

describe("deliveryAttemptManifest", () => {
  test("covers the whole backend vocabulary (anti-vacuity floor)", () => {
    // Four constants at ProcuLink.Core/Entities/DeliveryAttempt.cs:99-136. A manifest
    // that lost rows would make "unknown is not a success" trivially true by knowing
    // nothing at all. The cross-repo diff lives in deliveryAttemptMirror.test.ts.
    expect(DELIVERY_ATTEMPT_STATUS_FACTS.length).toBeGreaterThanOrEqual(4);
    expect([...new Set(DELIVERY_ATTEMPT_STATUS_FACTS.map((f) => f.status))]).toHaveLength(
      DELIVERY_ATTEMPT_STATUS_FACTS.length,
    );
  });

  test("exactly one status may render as a completed send", () => {
    expect(SENT_ATTEMPT_STATUSES).toEqual(["success"]);
  });

  test.each([...FALSE_POSITIVES, ...NEVER_WRITTEN])("%s resolves to unrecognised, never sent", (status) => {
    expect(deliveryAttemptOutcome(status)).toBe("unrecognised");
    expect(attemptSendWasObserved(status)).toBe(false);
  });

  test("matching is exact, not a substring", () => {
    // The property, stated directly: no string that merely CONTAINS a known status
    // may inherit its outcome.
    for (const { status } of DELIVERY_ATTEMPT_STATUS_FACTS) {
      expect(deliveryAttemptOutcome(`not_${status}`)).toBe("unrecognised");
      expect(deliveryAttemptOutcome(`${status}_pending`)).toBe("unrecognised");
    }
  });

  test("absent, empty and whitespace statuses are unrecognised", () => {
    expect(deliveryAttemptOutcome(null)).toBe("unrecognised");
    expect(deliveryAttemptOutcome(undefined)).toBe("unrecognised");
    expect(deliveryAttemptOutcome("")).toBe("unrecognised");
    expect(attemptSendWasObserved("   ")).toBe(false);
  });

  test("casing and surrounding whitespace do not defeat a real status", () => {
    expect(attemptSendWasObserved("  Success ")).toBe(true);
    expect(deliveryAttemptOutcome("FAILED")).toBe("failed");
  });
});

// ── The rendering: what colour the operator sees ─────────────────────────────

const getOrderPassport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiClient: { getOrderPassport, getDownloadUrl: vi.fn() },
  ApiHttpError: class ApiHttpError extends Error {
    status = 0;
  },
}));

afterEach(() => {
  cleanup();
  getOrderPassport.mockReset();
});

async function renderWith(status: string) {
  getOrderPassport.mockResolvedValue(passportWith(status));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrderPassport orderId="ord-1" />
    </QueryClientProvider>,
  );
  const row = await screen.findByTestId("delivery-attempt");
  await waitFor(() => expect(row).toBeTruthy());
  return row;
}

/** The status word the row prints, whose colour is the operator's first signal. */
function statusWordColor(row: HTMLElement, status: string): string {
  const el = [...row.querySelectorAll("span")].find((s) => s.textContent === status);
  expect(el, `the row does not print the status "${status}"`).toBeTruthy();
  return (el as HTMLElement).style.color;
}

describe("the row never paints an unrecognised status green", () => {
  test.each([...FALSE_POSITIVES, ...NEVER_WRITTEN])("%s is amber, not green", async (status) => {
    const row = await renderWith(status);
    expect(statusWordColor(row, status)).toBe(AMBER);
    expect(statusWordColor(row, status)).not.toBe(GREEN);
    // The other half of the same lie: the button offering the bytes as proof.
    expect(screen.getByRole("button", { name: /Download the file we tried to send/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download what we sent/ })).toBeNull();
    expect(screen.getByText(/Fingerprint of the file we tried to send/)).toBeTruthy();
  });

  test.each(["dispatching", "unconfirmed"])("%s is amber and says the outcome is unknown", async (status) => {
    const row = await renderWith(status);
    expect(statusWordColor(row, status)).toBe(AMBER);
    expect(screen.getByText("We do not know whether this file reached the supplier.")).toBeTruthy();
  });

  test("failed is red", async () => {
    const row = await renderWith("failed");
    expect(statusWordColor(row, "failed")).toBe(RED);
  });

  test("success is green, and says so", async () => {
    // Anti-vacuity for the colour assertions: proves GREEN is reachable at all.
    const row = await renderWith("success");
    expect(statusWordColor(row, "success")).toBe(GREEN);
    expect(screen.getByRole("button", { name: /Download what we sent/ })).toBeTruthy();
    expect(screen.getByText(/Fingerprint of the file we sent/)).toBeTruthy();
  });
});
