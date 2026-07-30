import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PassportDto, PassportDeliveryAttempt } from "@/types/procurement";

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
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { ApiHttpError } from "@/lib/api-client";
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

    // Both attempts get a control; only the one whose send was OBSERVED says "what we sent".
    const buttons = await screen.findAllByRole("button", { name: /download (what we sent|the file we tried to send)/i });
    expect(buttons).toHaveLength(2);
  });

  it("downloads the artifact THAT attempt sent, not the latest one", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockResolvedValue({
      url: "https://r2.example/signed/first",
      expiresAt: "2026-07-30T09:45:00Z",
    });
    const tab = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    vi.stubGlobal("open", vi.fn(() => tab));

    renderPassport();

    // Attempt #1 sent the FIRST artifact — the one a naive "the artifact" wiring would miss.
    // It failed, so the control says "tried to send"; the bytes it points at are the same.
    const row = await attemptRow("#1");
    fireEvent.click(within(row).getByRole("button", { name: /download the file we tried to send/i }));

    await waitFor(() => expect(api.getDownloadUrl).toHaveBeenCalledTimes(1));
    expect(api.getDownloadUrl).toHaveBeenCalledWith(ORDER_ID, ARTIFACT_A);
    await waitFor(() => expect(tab.location.href).toBe("https://r2.example/signed/first"));
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
    api.getDownloadUrl.mockRejectedValue(new Error("boom"));
    vi.stubGlobal("open", vi.fn(() => ({ location: { href: "" }, close: vi.fn(), opener: {} })));
    renderPassport();

    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    // A statusless failure gets the generic sentence — never one of the specific stories.
    expect(await within(row).findByText(/couldn't get that file/i)).toBeInTheDocument();
    expect(within(row).queryByText(/data-retention/i)).not.toBeInTheDocument();
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

// ─── "Did we send it at all?" ─────────────────────────────────────────────────
//
// The packet is rigorous about WHICH bytes and silent about WHETHER they went out.
// Two attempt states exist in which the backend documents, in its own words, that it does
// NOT know a send happened:
//
//   • `dispatching` — the row is committed BEFORE the network write, purely as a crash
//     backstop. DeliveryService says the reachable outcomes are "sent and accepted", "sent
//     and rejected" and "never sent", and that this process cannot tell them apart.
//   • `unconfirmed` — the park. Its own reason string reads "The artifact may have been
//     sent, but the outcome was never observed."
//
// Neither carries a dispatched-bytes fingerprint (ParkUnconfirmedAsync never stamps one),
// and the passport applies no status filter — so both arrive with a real artifact id and a
// null hash. Offering "Download what we sent" there is the exact over-claim this feature
// exists to prevent, one axis over.

function unknownOutcomeAttempt(status: string): PassportDeliveryAttempt {
  return {
    attemptNumber: 1,
    status,
    channel: "http",
    destination: "https://nordmark.example/po",
    attemptedAt: "2026-07-30T09:10:00Z",
    responseCode: null,
    acknowledgedAt: null,
    rejectionReason: null,
    errorMessage: null,
    artifactId: ARTIFACT_B, // the key survives the crash, so the link is real…
    artifactSha256: null,   // …but nothing ever recorded what went out
  } as PassportDeliveryAttempt;
}

describe("What we sent vs what we only tried to send", () => {
  it("does not claim a crashed in-flight attempt sent anything", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ deliveryAttempts: [unknownOutcomeAttempt("dispatching")] }),
    );
    renderPassport();

    const row = await attemptRow("#1");
    expect(within(row).queryByRole("button", { name: /download what we sent/i })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /download the file we tried to send/i })).toBeInTheDocument();
    expect(within(row).getByText(/whether this file reached the supplier/i)).toBeInTheDocument();
  });

  it("does not claim a parked, never-observed attempt sent anything", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ deliveryAttempts: [unknownOutcomeAttempt("unconfirmed")] }),
    );
    renderPassport();

    const row = await attemptRow("#1");
    expect(within(row).queryByRole("button", { name: /download what we sent/i })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /download the file we tried to send/i })).toBeInTheDocument();
    expect(within(row).getByText(/whether this file reached the supplier/i)).toBeInTheDocument();
  });

  it("still says plainly 'what we sent' when the channel saw the supplier accept it", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    renderPassport();

    const row = await attemptRow("#2"); // success — the one state where a send WAS observed
    expect(within(row).getByRole("button", { name: /download what we sent/i })).toBeInTheDocument();
    expect(within(row).queryByText(/whether this file reached the supplier/i)).not.toBeInTheDocument();
  });

  it("labels the fingerprint by what actually happened, not by what we hoped", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        deliveryAttempts: [
          { ...unknownOutcomeAttempt("failed"), errorMessage: "Connection refused", artifactSha256: SHA_B },
        ],
      }),
    );
    renderPassport();

    const row = await attemptRow("#1");
    expect(within(row).getByText(/fingerprint of the file we tried to send/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^fingerprint of the file we sent/i)).not.toBeInTheDocument();
  });
});

// ─── A blocked pop-up is not a silent no-op ──────────────────────────────────
//
// window.open() after an await is outside the click's transient activation: Safari refuses
// it outright, Chrome and Firefox drop it once the activation window lapses — which a cold
// Railway round trip can outlive. The old code never checked the return value and its catch
// only covered the fetch, so a blocked pop-up produced no file, no error and no message.

type FakeTab = { location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown };
const fakeTab = (): FakeTab => ({ location: { href: "" }, close: vi.fn(), opener: {} });

describe("A blocked pop-up is not a silent no-op", () => {
  it("says the browser blocked it instead of doing nothing at all", async () => {
    api.getOrderPassport.mockResolvedValue(passport());
    vi.stubGlobal("open", vi.fn(() => null)); // what a blocked pop-up returns
    renderPassport();

    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    expect(await within(row).findByText(/blocked the download window/i)).toBeInTheDocument();
    // No point burning a signed URL for a tab that will never exist.
    expect(api.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("opens the tab inside the click, and only then points it at the signed URL", async () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab);
    vi.stubGlobal("open", open);

    let resolveUrl: (v: { url: string; expiresAt: string }) => void = () => {};
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockImplementation(() => new Promise((r) => { resolveUrl = r as typeof resolveUrl; }));

    renderPassport();
    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    // Opened synchronously — before any signed URL exists. That is the whole point.
    // Blank target, and NO `noopener` feature: with it window.open returns null even when
    // nothing was blocked, which would make "blocked" unobservable. The back-reference is
    // severed by hand instead.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");
    expect(tab.opener).toBeNull();

    resolveUrl({ url: "https://r2.example/signed/second", expiresAt: "2026-07-30T09:45:00Z" });
    await waitFor(() => expect(tab.location.href).toBe("https://r2.example/signed/second"));
  });

  it("closes the tab it opened when the link cannot be produced", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab));
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockRejectedValue(new ApiHttpError("Download URL failed", 410));

    renderPassport();
    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
    expect(tab.location.href).toBe("");
  });
});

// ─── One failure, one true sentence ──────────────────────────────────────────
//
// The endpoint distinguishes 404 (no such artifact for this order), 410 Gone (blob purged
// per the org's retention policy) and 429 (signed-URL rate limit). Telling the retention
// story for all three is false twice out of three times.

const FAILURE_COPY: Array<[number, RegExp]> = [
  [410, /removed under your data-retention setting/i],
  [404, /no stored copy of that file/i],
  [429, /too many download requests/i],
  [403, /access to that file/i],
];

describe("One failure, one true sentence", () => {
  for (const [status, expected] of FAILURE_COPY) {
    it(`explains ${status} in its own words`, async () => {
      vi.stubGlobal("open", vi.fn(() => fakeTab()));
      api.getOrderPassport.mockResolvedValue(passport());
      api.getDownloadUrl.mockRejectedValue(new ApiHttpError(`Download URL failed: ${status}`, status));
      renderPassport();

      const row = await attemptRow("#2");
      fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

      expect(await within(row).findByText(expected)).toBeInTheDocument();
    });
  }

  it("does not tell the retention story for a plain 404", async () => {
    vi.stubGlobal("open", vi.fn(() => fakeTab()));
    api.getOrderPassport.mockResolvedValue(passport());
    api.getDownloadUrl.mockRejectedValue(new ApiHttpError("Download URL failed: 404", 404));
    renderPassport();

    const row = await attemptRow("#2");
    fireEvent.click(within(row).getByRole("button", { name: /download what we sent/i }));

    await within(row).findByText(/no stored copy of that file/i);
    expect(within(row).queryByText(/data-retention/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/may have expired/i)).not.toBeInTheDocument();
  });
});
