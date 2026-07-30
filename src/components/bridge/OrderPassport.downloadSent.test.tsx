import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PassportDto } from "@/types/procurement";

// WP-34 — "prove what was sent".
//
// GET /api/orders/{id}/artifacts/{artifactId}/download has existed with zero callers on
// either side. An operator facing a supplier's "we never got it" could see a storage key
// and nothing else: no way to retrieve the bytes, no fingerprint to check them against.
//
// What these tests hold to:
//   • the download action reaches the REAL endpoint with the artifact THAT attempt sent —
//     not "the" artifact, because an order can hold several of each;
//   • the fingerprint recorded at dispatch is on screen next to it, so the operator can
//     compare the file they just downloaded;
//   • when nothing proves which bytes went out, there is NO offer to download them.
//     A button that guesses is worse than no button on a dispute.

const api = {
  getOrderPassport: vi.fn(),
  getDownloadUrl: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
    getDownloadUrl: (...a: unknown[]) => api.getDownloadUrl(...a),
  },
}));

import { OrderPassport } from "./OrderPassport";

const ORDER_ID = "ord-1";
const ARTIFACT_A = "artifact-aaa";
const ARTIFACT_B = "artifact-bbb";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function passport(overrides: Partial<PassportDto> = {}): PassportDto {
  return {
    order: {
      id: ORDER_ID,
      poNumber: "PO-88231",
      status: "delivered",
      supplierId: "sup-1",
      supplierName: "Nordmark",
      buyerName: "Acme",
      currency: "EUR",
      orderDate: "2026-07-30",
      createdAt: "2026-07-30T09:00:00Z",
      updatedAt: "2026-07-30T09:30:00Z",
      isSample: false,
    },
    sourceArtifact: { storageKey: "org/ord-1/source.csv", detectedFormat: "csv" },
    canonical: { lineCount: 2, currency: "EUR", totalValue: 120, totalQuantity: 6 },
    supplierProfile: null,
    validationResults: [],
    mappingDecisions: [],
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: {
      artifactId: ARTIFACT_B,
      format: "cxml",
      fileKey: `org/${ORDER_ID}/artifacts/${ARTIFACT_B}.xml`,
      createdAt: "2026-07-30T09:20:00Z",
      artifactSha256: SHA_B,
    },
    deliveryAttempts: [
      {
        attemptNumber: 1,
        status: "failed",
        channel: "http",
        destination: "https://nordmark.example/po",
        attemptedAt: "2026-07-30T09:10:00Z",
        responseCode: 503,
        acknowledgedAt: null,
        rejectionReason: null,
        errorMessage: "Temporarily unavailable",
        artifactId: ARTIFACT_A,
        artifactSha256: SHA_A,
      },
      {
        attemptNumber: 2,
        status: "success",
        channel: "http",
        destination: "https://nordmark.example/po",
        attemptedAt: "2026-07-30T09:25:00Z",
        responseCode: 200,
        acknowledgedAt: "2026-07-30T09:25:02Z",
        rejectionReason: null,
        errorMessage: null,
        artifactId: ARTIFACT_B,
        artifactSha256: SHA_B,
      },
    ],
    supplierResponse: {
      outcome: "acknowledged",
      acknowledgedAt: "2026-07-30T09:25:02Z",
      rejectionReason: null,
      responseCode: 200,
      responseBody: null,
    },
    finalStatus: "delivered",
    timeline: [],
    notes: [],
    ...overrides,
  } as PassportDto;
}

function renderPassport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderPassport orderId={ORDER_ID} />
    </QueryClientProvider>,
  );
}

/** The attempt row containing the given attempt marker (#1 / #2). */
async function attemptRow(marker: string): Promise<HTMLElement> {
  const label = await screen.findByText(marker);
  return label.closest("[data-testid='delivery-attempt']") as HTMLElement;
}

afterEach(() => {
  cleanup();
  api.getOrderPassport.mockReset();
  api.getDownloadUrl.mockReset();
  vi.unstubAllGlobals();
});

describe("Download what we sent — the control exists and reaches the real endpoint", () => {
  it("offers the download on every attempt whose artifact is known", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    renderPassport();

    const buttons = await screen.findAllByRole("button", { name: /download what we sent/i });
    expect(buttons).toHaveLength(2);
  });

  it("downloads the artifact THAT attempt sent, not the latest one", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockResolvedValue({
      url: "https://r2.example/signed/first",
      expiresAt: "2026-07-30T09:45:00Z",
    });
    const open = vi.fn();
    vi.stubGlobal("open", open);

    renderPassport();

    // Attempt #1 sent the FIRST artifact — the one a naive "the artifact" wiring would miss.
    const row = await attemptRow("#1");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    await waitFor(() => expect(api.getDownloadUrl).toHaveBeenCalledTimes(1));
    expect(api.getDownloadUrl).toHaveBeenCalledWith(ORDER_ID, ARTIFACT_A);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://r2.example/signed/first", "_blank", "noopener,noreferrer"));
  });

  it("shows the fingerprint recorded for that attempt so the downloaded file can be checked", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    renderPassport();

    const first = await attemptRow("#1");
    expect(within(first).getByText(SHA_A)).toBeInTheDocument();

    const second = await attemptRow("#2");
    expect(within(second).getByText(SHA_B)).toBeInTheDocument();
  });

  it("shows the generated file's fingerprint on the artifact itself", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    renderPassport();

    const label = await screen.findByText(/fingerprint of the file we generated/i);
    const block = label.parentElement as HTMLElement;
    expect(within(block).getByText(SHA_B)).toBeInTheDocument();
  });

  it("surfaces a failure to produce the link instead of silently doing nothing", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockRejectedValue(new Error("Download URL failed: purged per retention policy"));
    renderPassport();

    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    expect(await within(row).findByText(/couldn't get that file/i)).toBeInTheDocument();
  });
});

describe("No proof, no offer", () => {
  it("offers no download for an attempt whose artifact is unknown", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        outputArtifact: null,
        deliveryAttempts: [
          {
            attemptNumber: 1,
            status: "failed",
            channel: "http",
            destination: "https://nordmark.example/po",
            attemptedAt: "2026-07-30T09:10:00Z",
            responseCode: null,
            acknowledgedAt: null,
            rejectionReason: null,
            errorMessage: "Connection refused",
            artifactId: null,   // no dispatch evidence ties this attempt to any artifact
            artifactSha256: null,
          },
        ],
      }),
    );
    renderPassport();

    await screen.findByText("#1");
    expect(screen.queryByRole("button", { name: /download what we sent/i })).not.toBeInTheDocument();
    // ...and it says why, rather than leaving a silent gap.
    expect(screen.getByText(/no stored copy of what this attempt sent/i)).toBeInTheDocument();
  });

  it("still shows the dispatched fingerprint when only the artifact row is missing", async () => {
    // Half-evidence: we know what bytes went out, but not which stored artifact they were.
    // The hash is real evidence and stays; the download offer does not appear.
    api.getOrderPassport.mockResolvedValue(
      passport({
        outputArtifact: null,
        deliveryAttempts: [
          {
            attemptNumber: 1,
            status: "success",
            channel: "sftp",
            destination: "sftp://nordmark.example/in",
            attemptedAt: "2026-07-30T09:10:00Z",
            responseCode: null,
            acknowledgedAt: "2026-07-30T09:10:01Z",
            rejectionReason: null,
            errorMessage: null,
            artifactId: null,
            artifactSha256: SHA_A,
          },
        ],
      }),
    );
    renderPassport();

    const row = await attemptRow("#1");
    expect(within(row).getByText(SHA_A)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /download what we sent/i })).not.toBeInTheDocument();
  });

  it("says nothing about a match when the bytes we sent are not the bytes we generated", async () => {
    // Corruption detection is the whole point of carrying both hashes: an attempt that
    // dispatched something OTHER than the artifact it names must not read as verified.
    api.getOrderPassport.mockResolvedValue(
      passport({
        deliveryAttempts: [
          {
            attemptNumber: 1,
            status: "success",
            channel: "http",
            destination: "https://nordmark.example/po",
            attemptedAt: "2026-07-30T09:25:00Z",
            responseCode: 200,
            acknowledgedAt: "2026-07-30T09:25:02Z",
            rejectionReason: null,
            errorMessage: null,
            artifactId: ARTIFACT_B,
            artifactSha256: "c".repeat(64), // ≠ the artifact's own SHA_B
          },
        ],
      }),
    );
    renderPassport();

    const row = await attemptRow("#1");
    expect(within(row).queryByText(/matches the file we generated/i)).not.toBeInTheDocument();
    expect(within(row).getByText(/does not match the file we generated/i)).toBeInTheDocument();
  });

  it("confirms the match when the sent bytes are the generated bytes", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    renderPassport();

    const second = await attemptRow("#2"); // sent ARTIFACT_B with SHA_B — the artifact's own hash
    expect(within(second).getByText(/matches the file we generated/i)).toBeInTheDocument();

    // Attempt #1 sent a DIFFERENT artifact, so there is nothing to compare it against and
    // the passport claims nothing either way.
    const first = await attemptRow("#1");
    expect(within(first).queryByText(/matches the file we generated/i)).not.toBeInTheDocument();
    expect(within(first).queryByText(/does not match the file we generated/i)).not.toBeInTheDocument();
  });
});
