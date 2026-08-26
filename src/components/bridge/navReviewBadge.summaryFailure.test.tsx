import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrdersSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// THE "NEEDS REVIEW" NAV BADGE READ ZERO WHEN IT MEANT "I DON'T KNOW".
//
// THE DEFECT, VERBATIM — the same two lines in two files:
//
//   BridgeTopbar.tsx    const { data: ordersSummary } = useQuery({ queryKey: ["orders-summary"], … });
//                       const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;
//   BridgeSidebar.tsx   const { data: ordersSummary } = useQuery({ queryKey: ["orders-summary"], … });
//                       const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;
//                       const badgeFor = (key) => (key === "review" && reviewCount > 0 ? reviewCount : undefined);
//
// Neither destructured `isError`. So a dead GET /api/orders/summary produced
// `?? 0`, 0 produced no badge, and NO BADGE IS EXACTLY WHAT AN EMPTY REVIEW
// QUEUE LOOKS LIKE. Not a missing number — a wrong answer, rendered in the app
// chrome that is on screen on every route.
//
// Both surfaces are covered here in one file because they are one defect written
// twice. Fixing one and not the other would move the lie from desktop to the
// mobile drawer.
//
// WHY EACH TEST HAS A TWIN. "The badge is absent" is true both when the summary
// says zero and when the summary never arrived — that indistinguishability IS
// the bug. So every failure assertion below is paired with a control that runs
// the SAME component over the SAME fixture with the query RESOLVING to an empty
// histogram. If both passed against a component that always drew the dash, the
// suite would prove nothing.
// ─────────────────────────────────────────────────────────────────────────────

const getOrdersSummary = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrdersSummary: (...a: unknown[]) => getOrdersSummary(...a),
    getOrders: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 }),
  },
  getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth" }),
  checkAdminAccess: vi.fn().mockResolvedValue(false),
  getBuyers: vi.fn().mockResolvedValue([]),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { id: "org_1", name: "Acme" }, membership: { role: "org:admin" } }),
  useOrganizationList: () => ({ isLoaded: true, setActive: vi.fn(), userMemberships: { data: [], isLoading: false, isFetching: false, hasNextPage: false, fetchNext: vi.fn() } }),
  useClerk: () => ({ openCreateOrganization: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn() }),
  useUser: () => ({ user: null, isLoaded: true }),
}));

// Signed in, so every `enabled: queryEnabled` query actually runs. Mocked at the
// hook rather than through Clerk's useAuth so the gate cannot silently disable
// the query under test and turn a failure assertion into a never-fetched one.
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

// Outbound labels, from the real helper — the direction relabel is a different
// concern and a stubbed literal here would drift from it.
vi.mock("@/hooks/useOrderDirection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOrderDirection")>(
    "@/hooks/useOrderDirection",
  );
  return { ...actual, useOrderDirection: () => ({ direction: "outbound", labels: actual.partyLabels("outbound") }) };
});

// Chrome that has nothing to do with the badge and drags its own queries in.
vi.mock("./OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("./UserChipMenu", () => ({ UserChipMenu: () => null }));
vi.mock("./SetupProgressChip", () => ({ SetupProgressChip: () => null }));

import { BridgeTopbar } from "./BridgeTopbar";
import { BridgeSidebar, NAV_BADGE_UNKNOWN_LABEL } from "./BridgeSidebar";

const SUMMARY_EMPTY: OrdersSummary = { byStatus: {}, total: 0 };
const SUMMARY_WITH_REVIEW: OrdersSummary = { byStatus: { pending_review: 4 }, total: 40 };

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * jsdom applies no Tailwind, so `hidden md:flex` renders exactly like a visible
 * element and every breakpoint tree mounts at once. An unscoped query would
 * therefore read whichever copy of the chrome it hit first. Both surfaces are
 * scoped to their own landmark, and `scopingBites()` below proves the scoping
 * actually narrows rather than silently matching the whole document.
 */
function topbarNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

function sidebarNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Workspace" });
}

beforeEach(() => {
  getOrdersSummary.mockReset();
});

afterEach(cleanup);

describe("nav review badge — scoping control (anti-vacuity)", () => {
  it("the landmark really is narrower than the document", async () => {
    // If `within(topbarNav())` were quietly equivalent to `screen`, every
    // assertion below would be a document-wide text search and the breakpoint
    // caveat above would be decorative. The topbar renders a Notifications
    // control OUTSIDE the Primary nav; the scoped query must not see it.
    getOrdersSummary.mockResolvedValue(SUMMARY_EMPTY);
    renderWith(<BridgeTopbar />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: /notifications/i }).length).toBeGreaterThan(0));
    expect(within(topbarNav()).queryByRole("button", { name: /notifications/i })).toBeNull();
  });
});

describe("topbar nav badge — a failed summary is not zero", () => {
  it("marks the count unavailable when GET /api/orders/summary fails", async () => {
    getOrdersSummary.mockRejectedValue(new Error("500 Internal Server Error"));
    renderWith(<BridgeTopbar />);

    await waitFor(() =>
      expect(within(topbarNav()).getByText(NAV_BADGE_UNKNOWN_LABEL)).toBeTruthy(),
    );
  });

  it("prints the real number when the summary answers", async () => {
    getOrdersSummary.mockResolvedValue(SUMMARY_WITH_REVIEW);
    renderWith(<BridgeTopbar />);

    await waitFor(() => expect(within(topbarNav()).getByText("4")).toBeTruthy());
    expect(within(topbarNav()).queryByText(NAV_BADGE_UNKNOWN_LABEL)).toBeNull();
  });

  it("shows NOTHING when the summary answers zero — the failure marker is not a permanent fixture", async () => {
    // The control that gives the first test its meaning: an empty queue and a
    // dead endpoint must not look alike, and the fix must not achieve that by
    // marking everything unavailable.
    getOrdersSummary.mockResolvedValue(SUMMARY_EMPTY);
    renderWith(<BridgeTopbar />);

    await waitFor(() => expect(topbarNav()).toBeTruthy());
    await waitFor(() => expect(getOrdersSummary).toHaveBeenCalled());
    expect(within(topbarNav()).queryByText(NAV_BADGE_UNKNOWN_LABEL)).toBeNull();
  });
});

describe("sidebar (mobile drawer) nav badge — the same defect, the same fix", () => {
  it("marks the count unavailable when GET /api/orders/summary fails", async () => {
    getOrdersSummary.mockRejectedValue(new Error("500 Internal Server Error"));
    renderWith(<BridgeSidebar />);

    await waitFor(() =>
      expect(within(sidebarNav()).getByText(NAV_BADGE_UNKNOWN_LABEL)).toBeTruthy(),
    );
  });

  it("prints the real number when the summary answers", async () => {
    getOrdersSummary.mockResolvedValue(SUMMARY_WITH_REVIEW);
    renderWith(<BridgeSidebar />);

    await waitFor(() => expect(within(sidebarNav()).getByText("4")).toBeTruthy());
    expect(within(sidebarNav()).queryByText(NAV_BADGE_UNKNOWN_LABEL)).toBeNull();
  });

  it("shows NOTHING when the summary answers zero", async () => {
    getOrdersSummary.mockResolvedValue(SUMMARY_EMPTY);
    renderWith(<BridgeSidebar />);

    await waitFor(() => expect(getOrdersSummary).toHaveBeenCalled());
    await waitFor(() => expect(sidebarNav()).toBeTruthy());
    expect(within(sidebarNav()).queryByText(NAV_BADGE_UNKNOWN_LABEL)).toBeNull();
  });
});
