/* ── One primary action on the upload screen ──────────────────────────────────
 *
 * THE DEFECT, VERBATIM.
 *
 *     const isUploadDisabled = uploading || isReadOnly || !hasSupplier || suppliersLoading;
 *
 * `!selectedFile` was not in that condition. So once a supplier was chosen and
 * before any file was, the footer CTA rendered ENABLED, in the full green primary
 * treatment, reading "Choose a file to upload" — and its entire behaviour was:
 *
 *     if (!selectedFile) {
 *       fileInputRef.current?.click();
 *       return;
 *     }
 *
 * which is the identical action to the blue "Browse files" button inside the drop
 * zone, eight hundred lines up. Two filled, shadowed, primary-weight buttons in
 * two different brand colours, doing one thing. The comment above the CTA said
 * "Rendered ONCE in the footer so there is never a duplicate CTA in the DOM" —
 * true of the element and false of the action, which is why reading the code did
 * not catch it.
 *
 * WHAT THIS GUARDS, AND IN WHICH DIRECTION.
 *
 * Not "the button is disabled" on its own — that could be satisfied while leaving
 * the click handler intact behind a `pointer-events` change, and it says nothing
 * about the duplication. The load-bearing assertion is that with no file chosen,
 * pressing the send CTA does not open the file picker: the two controls must not
 * be interchangeable. The counterpart assertion, that the picker still works from
 * the drop zone, keeps a future "fix" from disabling both.
 *
 * NOT TESTED HERE, DELIBERATELY: the absence of fabricated parse progress. That is
 * UploadWorkbench.parseProgress.test.tsx, and it is a separate defect with a
 * separate guard — do not merge them.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Supplier } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
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
  // Declared inside the factory: vi.mock is hoisted above every top-level binding
  // in this file, so a class defined outside would be in its temporal dead zone
  // by the time the component imports it.
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
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));

import { UploadWorkbench } from "./UploadWorkbench";

const SUPPLIER: Supplier = {
  id: "sup-1",
  name: "BoltWorks BV",
  code: "BOLT",
  status: "active",
} as Supplier;

function csv(name = "purchase-order.csv") {
  return new File(["po,qty\nA-1,2\n"], name, { type: "text/csv" });
}

/** Mount with a supplier resolved and selectable. No file is chosen. */
async function mount() {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  api.detectFormat.mockReturnValue(new Promise(() => {}));

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  // Wait for the supplier query to SETTLE, not merely to have been called: the
  // send CTA is disabled while `suppliersLoading` is true, so asserting on it
  // before the list lands would measure the loading state and call it the fix.
  await waitFor(() => {
    if (!document.body.textContent?.includes(SUPPLIER.name)) {
      throw new Error("supplier list has not resolved yet");
    }
  });
  return view;
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error("no file input rendered");
  return el;
}

async function chooseFile() {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [csv()] } });
  });
}

/** The drop zone's own picker button. */
function browseButton(): HTMLButtonElement {
  const el = screen
    .getAllByRole("button")
    .find((b) => /browse files|change file/i.test(b.textContent ?? "")) as
    | HTMLButtonElement
    | undefined;
  if (!el) throw new Error("no browse/change-file button rendered");
  return el;
}

/** The step-3 submit CTA in the action footer. */
function sendButton(): HTMLButtonElement {
  const el = screen
    .getAllByRole("button")
    .find((b) => /upload & review|add a file to send|upload \d+ files/i.test(b.textContent ?? "")) as
    | HTMLButtonElement
    | undefined;
  if (!el) throw new Error("no send CTA rendered");
  return el;
}

/** Every control currently declaring itself the screen's primary action. */
function primaries(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-cta-weight="primary"]'));
}

/* ── Anti-vacuity floor ───────────────────────────────────────────────────────
 *
 * Asserted BEFORE any negative, and it has to be: every claim below is of the
 * shape "this control did NOT do that", and a screen that rendered neither
 * control passes all of them for free. The helpers above throw on a missing
 * element for the same reason, so a render-nothing regression fails at lookup
 * rather than reporting a clean bill of health. */
async function floor() {
  const send = sendButton();
  const browse = browseButton();
  // Two distinct controls, both really on the screen.
  expect(send, "the send CTA and the browse button resolved to the same element").not.toBe(browse);
  expect(document.body.contains(send)).toBe(true);
  expect(document.body.contains(browse)).toBe(true);
  expect(fileInput()).toBeTruthy();
  // Both controls must actually declare a weight, or every "exactly one primary"
  // assertion below is measuring an attribute nobody sets.
  expect(send.dataset.ctaWeight, "the send CTA declares no weight").toBeDefined();
  expect(browse.dataset.ctaWeight, "the browse button declares no weight").toBeDefined();
  return { send, browse };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("with a supplier chosen and no file yet", () => {
  it("does not offer the file picker twice", async () => {
    await mount();
    const { send, browse } = await floor();

    // The picker is instrumented rather than the handler: what matters is whether
    // pressing the send CTA reaches the input, by any route.
    const opened = vi.fn();
    fileInput().addEventListener("click", opened);

    // The browse button is the one control that legitimately opens it.
    fireEvent.click(browse);
    expect(opened, "the drop zone's own browse button stopped opening the picker").toHaveBeenCalledTimes(1);

    opened.mockClear();
    fireEvent.click(send);
    expect(
      opened,
      "the send CTA opened the file picker — it is a second copy of Browse files again",
    ).not.toHaveBeenCalled();
  });

  it("disables the send CTA rather than dressing it as an available action", async () => {
    await mount();
    const { send } = await floor();

    expect(send.disabled, "the send CTA is enabled with nothing to send").toBe(true);
    // It must not invite the picker in words either.
    expect(send.textContent ?? "").not.toMatch(/choose a file/i);

    // The drop zone owns the only primary action at this point.
    const { browse } = await floor();
    expect(browse.dataset.ctaWeight).toBe("primary");
    expect(primaries(), "more than one control claims to be the primary action").toEqual([browse]);
  });

  it("never uploads when there is no file", async () => {
    await mount();
    const { send } = await floor();

    fireEvent.click(send);
    expect(api.uploadPurchaseOrder).not.toHaveBeenCalled();
  });
});

describe("once a file is chosen", () => {
  it("moves the primary weight to the send CTA and demotes the picker", async () => {
    await mount();
    await chooseFile();
    const { send, browse } = await floor();

    expect(browse.textContent ?? "", "the file was never selected").toMatch(/change file/i);
    expect(send.disabled, "the send CTA is still disabled with a file ready").toBe(false);

    // The picker keeps its job and its 44px target; what it gives up is the
    // primary treatment, so the two are no longer competing for the same weight.
    expect(browse.dataset.ctaWeight).toBe("secondary");
    expect(send.dataset.ctaWeight).toBe("primary");
    expect(primaries()).toEqual([send]);
  });

  it("keeps the picker reachable so a wrong file can be swapped", async () => {
    await mount();
    await chooseFile();
    const { browse } = await floor();

    const opened = vi.fn();
    fileInput().addEventListener("click", opened);
    fireEvent.click(browse);
    expect(opened, "the file can no longer be changed").toHaveBeenCalledTimes(1);
  });
});
