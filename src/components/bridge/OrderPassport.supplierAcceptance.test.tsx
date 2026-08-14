import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderPassport } from "@/components/bridge/OrderPassport";
import type { PassportDto, PassportDeliveryAttempt } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// P0-8, fed back in verbatim.
//
// `DeliveryAttempt.AcknowledgedAt` was written as `result.Success ? now : null` —
// `now` being the instant WE finished dispatching, the same one stamped on
// `AttemptedAt`. `PassportService` derived outcome `"acknowledged"` from it, and
// this component rendered:
//
//     label   "Accepted"
//     detail  "Acknowledged by supplier"   (or "Response 200" when a code existed)
//     and     "Acknowledged: {timestamp}"
//
// No supplier had said anything. On SFTP, FTPS and SMTP no supplier COULD have:
// those channels carry no response at all. The correctly calibrated copy already
// existed one branch below — "Awaiting response" / "Delivered — no supplier
// confirmation yet" — and was unreachable, because every successful delivery
// satisfied the `"acknowledged"` branch above it.
//
// These tests assert the RENDERED TEXT an operator reads, not a prop and not the
// derivation, because the defect was a sentence on a screen. Every one of them
// fails on the old code.
// ─────────────────────────────────────────────────────────────────────────────

/** The exact words the defect put on screen. None may return, on any channel. */
const FORBIDDEN = [
  "Accepted",
  "Acknowledged by supplier",
  "Acknowledged:",
] as const;

const ARTIFACT_ID = "6f1c9a1e-0000-4000-8000-000000000001";

function attempt(over: Partial<PassportDeliveryAttempt> = {}): PassportDeliveryAttempt {
  return {
    attemptNumber: 1,
    status: "success",
    channel: "http",
    destination: "https://supplier.example/po",
    attemptedAt: "2026-08-06T09:00:00Z",
    responseCode: 200,
    transportAcceptedAt: "2026-08-06T09:00:00Z",
    rejectionReason: null,
    errorMessage: null,
    artifactId: ARTIFACT_ID,
    artifactSha256: "a".repeat(64),
    ...over,
  };
}

function passport(over: Partial<PassportDto> = {}): PassportDto {
  return {
    order: {
      id: "ord-1",
      poNumber: "PO-4711",
      status: "delivered",
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
    deliveryAttempts: [attempt()],
    supplierResponse: {
      outcome: "delivered",
      transportAcceptedAt: "2026-08-06T09:00:00Z",
      rejectionReason: null,
      responseCode: 200,
      responseBody: null,
    },
    finalStatus: "delivered",
    timeline: [],
    notes: [],
    ...over,
  } as PassportDto;
}

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

async function renderPassport(dto: PassportDto): Promise<string> {
  getOrderPassport.mockResolvedValue(dto);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrderPassport orderId="ord-1" />
    </QueryClientProvider>,
  );
  // Wait for the panel the supplier verdict lives in, then read the whole document —
  // the claim is about what a person can see anywhere on this screen, not about one node.
  await screen.findByText("Supplier response");
  return document.body.textContent ?? "";
}

describe("a delivered order never claims the supplier accepted it", () => {
  test("HTTP 200: says it is awaiting a response, and says nothing was acknowledged", async () => {
    const text = await renderPassport(passport());

    expect(text).toContain("Awaiting response");
    expect(text).toContain("Delivered — no supplier confirmation yet");

    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });

  /**
   * The channel that makes the old copy indefensible: a file written to an SFTP server,
   * with no response code and no response body. There is nothing here a supplier could
   * have sent, and the screen used to report "Accepted".
   */
  test("SFTP: same, with no response code to hide behind", async () => {
    const text = await renderPassport(
      passport({
        deliveryAttempts: [
          attempt({ channel: "sftp", destination: "sftp://supplier.example/in/po.csv", responseCode: null }),
        ],
        supplierResponse: {
          outcome: "delivered",
          transportAcceptedAt: "2026-08-06T09:00:00Z",
          rejectionReason: null,
          responseCode: null,
          responseBody: null,
        },
      }),
    );

    expect(text).toContain("Awaiting response");
    expect(text).toContain("Delivered — no supplier confirmation yet");
    expect(text).toContain("ProcuLink does not receive acknowledgements on any delivery channel.");

    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("the timestamp we generated is labelled as a send, not as an acknowledgement", async () => {
    const text = await renderPassport(passport());
    expect(text).toContain("Sent:");
    expect(text).not.toContain("Acknowledged:");
  });
});

describe("a real supplier verdict still renders", () => {
  test("a rejection is still reported as a rejection", async () => {
    const text = await renderPassport(
      passport({
        order: { ...passport().order, status: "rejected_by_supplier" },
        deliveryAttempts: [
          attempt({ status: "failed", responseCode: 422, transportAcceptedAt: null, rejectionReason: "Item not in supplier catalog" }),
        ],
        supplierResponse: {
          outcome: "rejected",
          transportAcceptedAt: null,
          rejectionReason: "Item not in supplier catalog",
          responseCode: 422,
          responseBody: null,
        },
        finalStatus: "rejected_by_supplier",
      }),
    );

    // A pass must stay a pass where it genuinely is one — and a refusal must stay a refusal.
    expect(text).toContain("Supplier rejected");
    expect(text).toContain("Item not in supplier catalog");
    expect(text).not.toContain("Awaiting response");
  });
});

describe("the supplier's own response body is shown, and shown as theirs", () => {
  /**
   * P0-12: a 2xx carrying an application-level refusal. ProcuLink still reports the
   * delivery — it parses no acknowledgement — but the operator can now read the endpoint's
   * own words instead of nothing at all.
   */
  test("a 2xx body renders, attributed to the supplier", async () => {
    const refusal = '{"accepted":false,"reason":"buyer ACME-42 is not registered"}';
    const text = await renderPassport(
      passport({
        supplierResponse: {
          outcome: "delivered",
          transportAcceptedAt: "2026-08-06T09:00:00Z",
          rejectionReason: null,
          responseCode: 200,
          responseBody: refusal,
        },
      }),
    );

    expect(text).toContain(refusal);
    // Attribution is the point: the body must never read as ProcuLink's own sentence.
    expect(text).toContain("What the supplier's endpoint returned");
    // ...and it still must not be mistaken for acceptance.
    expect(text).toContain("Awaiting response");
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("markup in a body is escaped, not interpreted", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const dto = passport({
      supplierResponse: {
        outcome: "delivered",
        transportAcceptedAt: "2026-08-06T09:00:00Z",
        rejectionReason: null,
        responseCode: 200,
        responseBody: hostile,
      },
    });
    const text = await renderPassport(dto);

    // Present as TEXT...
    expect(text).toContain(hostile);
    // ...and not as an element.
    expect(document.querySelector("img")).toBeNull();
  });

  test("no body means no block, rather than an empty one", async () => {
    const text = await renderPassport(passport());
    expect(text).not.toContain("What the supplier's endpoint returned");
  });
});
