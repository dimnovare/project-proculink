import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConnectionRevisionSummary } from "@/lib/api/types";
import type { BundleSummaryData } from "@/components/connections/HistoryDrawer";
import type {
  RevisionTestEvidence,
  UseConnectionRevisions,
} from "@/components/connections/useConnectionRevisions";

// STRUCT-1 — SupplierHistoryTab is a THIN consumer of useConnectionRevisions
// rendering the IDENTICAL HistoryContent the drawer shows. We mock the hook so
// these tests drive the VIEW: version rows render, "Make live" is gated on
// passing tests, and Test/Make-live call the relocated handlers.

const onTest = vi.fn();
const onRequestPublish = vi.fn();
const onRequestRollback = vi.fn();
const onRequestArchive = vi.fn();
const publishMutate = vi.fn();
const rollbackMutate = vi.fn();
const archiveMutate = vi.fn();
const setNotice = vi.fn();
const setConfirm = vi.fn();

const REVISIONS: ConnectionRevisionSummary[] = [
  { id: "rev-3", versionNo: 3, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: "2026-01-03T00:00:00Z" },
  { id: "rev-2", versionNo: 2, status: "published", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-02T00:00:00Z" },
  { id: "rev-1", versionNo: 1, status: "archived", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
];

const LIVE_SUMMARY: BundleSummaryData = {
  inputConfigured: true,
  outputTemplateConfigured: false,
  outputFormat: "csv",
  deliveryProtocol: "http",
  deliveryAutoDeliver: true,
  hasCredentials: true,
  itemMappingCount: 1,
  acceptanceBound: true,
  acceptanceVersionNo: 4,
  catalogMode: "live",
};

const PASSED_EVIDENCE: RevisionTestEvidence = {
  revisionId: "rev-3",
  // `passed` — the only outcome that may unlock "Make live". The other three
  // (failed / not_exercised / unrecognised) are covered in testPackOutcome.test.tsx.
  outcome: "passed",
  testedAt: "2026-01-04T00:00:00Z",
  summary: {
    outcome: "passed",
    replay: { outcome: "passed", orderCount: 2, outputErrors: 0, outputChanged: 0, validationChanged: 0, note: null },
    conformance: null,
    error: null,
    // Explicit rather than absent: `parseLeg` is a real leg of the pack, and a fixture
    // that could omit it is how the leg stayed invisible in the product for months.
    parseLeg: null,
  },
};

// Build a hook return value with overridable bits.
function hookValue(overrides: Partial<UseConnectionRevisions> = {}): UseConnectionRevisions {
  const base = {
    connection: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    activeRevision: undefined,
    activeRevisionId: "rev-2",
    revisions: REVISIONS,
    liveSummary: LIVE_SUMMARY,
    liveVersionNo: 2,
    testEvidence: null as RevisionTestEvidence | null,
    busy: false,
    testingRevisionId: null,
    rollingBackRevisionId: null,
    discardingRevisionId: null,
    notice: null,
    setNotice,
    confirm: null,
    setConfirm,
    onTest,
    onRequestPublish,
    onRequestRollback,
    onRequestArchive,
    createDraftMutation: { mutate: vi.fn(), isPending: false } as unknown,
    publishMutation: { mutate: publishMutate, isPending: false } as unknown,
    rollbackMutation: { mutate: rollbackMutate, isPending: false } as unknown,
    archiveMutation: { mutate: archiveMutate, isPending: false } as unknown,
  };
  return { ...base, ...overrides } as unknown as UseConnectionRevisions;
}

let currentHookValue: UseConnectionRevisions = hookValue();

vi.mock("@/components/connections/useConnectionRevisions", async (importActual) => {
  // Keep the real types/helpers (parseTestSummary etc.) but stub the hook.
  const actual = await importActual<typeof import("./useConnectionRevisions")>();
  return { ...actual, useConnectionRevisions: () => currentHookValue };
});

import { SupplierHistoryTab } from "./SupplierHistoryTab";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<SupplierHistoryTab connectionId="conn-1" />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentHookValue = hookValue();
});
afterEach(cleanup);

describe("SupplierHistoryTab", () => {
  it("renders a row per revision with its version number", () => {
    renderTab();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("disables 'Make live' until tests pass for that revision", () => {
    // No evidence → the draft's Make live is disabled.
    renderTab();
    const makeLive = screen.getByRole("button", { name: "Make live" });
    expect(makeLive).toBeDisabled();
    fireEvent.click(makeLive); // disabled → handler must not fire
    expect(onRequestPublish).not.toHaveBeenCalled();
  });

  it("enables 'Make live' once the draft's tests pass, and clicking it requests publish", () => {
    currentHookValue = hookValue({ testEvidence: PASSED_EVIDENCE });
    renderTab();
    const makeLive = screen.getByRole("button", { name: "Make live" });
    expect(makeLive).not.toBeDisabled();
    fireEvent.click(makeLive);
    expect(onRequestPublish).toHaveBeenCalledWith("rev-3", 3);
  });

  it("clicking Test calls onTest for that revision", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(onTest).toHaveBeenCalledWith("rev-3");
  });

  it("the archived revision offers Restore, which requests rollback", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Use this version" }));
    expect(onRequestRollback).toHaveBeenCalledWith("rev-1", 1);
  });

  it("renders the live configuration summary from liveSummary", () => {
    renderTab();
    const section = screen.getByLabelText("Live configuration summary");
    // outputFormat csv surfaces as the uppercased value.
    expect(within(section).getByText("CSV")).toBeInTheDocument();
  });

  it("shows the confirm dialog when the hook reports a pending confirm and fires the mutation on confirm", () => {
    currentHookValue = hookValue({ confirm: { kind: "publish", revisionId: "rev-3", versionNo: 3 } });
    renderTab();
    // Dialog title from the shared ConnectionConfirmDialog.
    expect(screen.getByText("Make v3 live?")).toBeInTheDocument();
    // Scope to the dialog so we hit ITS "Make live" (the draft row also has one).
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make live" }));
    expect(publishMutate).toHaveBeenCalledWith("rev-3");
  });
});
