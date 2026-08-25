import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConnectionSummary } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// The nav taught a word the destination never said.
//
// The suppliers hub tab that opens /connections is labelled "Supplier changes"
// (HubTabs.tsx — "connection" is not one of the approved nav nouns). The page it
// opens renders its matching h1 sr-only, so a SIGHTED user saw no heading at all,
// and every visible string on the page — empty state, error state, loading label,
// browser tab title — said "connections" instead. One word in the nav, another on
// the destination, and nothing on screen joining them up.
//
// These tests derive the expected word from HUB_TABS, the registry that owns the
// nav label, rather than typing it out: if the tab is ever relabelled, the page
// copy has to move with it or this file goes red.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/connections",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

let listResult: () => Promise<ConnectionSummary[]>;
vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  listConnections: () => listResult(),
}));

import { ConnectionsList } from "./ConnectionsList";
import { HUB_TABS } from "@/components/bridge/layout/HubTabs";
import { metadata } from "@/app/(app)/connections/page";

/** The nav label that reaches this page — the word the copy has to speak. */
const NAV_LABEL = (() => {
  const tab = Object.values(HUB_TABS)
    .flat()
    .find((t) => t.href === "/connections");
  if (!tab) throw new Error("No hub tab points at /connections — this test is checking nothing.");
  return tab.label;
})();

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectionsList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listResult = () => Promise.resolve([]);
});

afterEach(() => cleanup());

describe("the /connections page speaks the word its nav tab uses", () => {
  it("names a tab, so the derived label is a real string", () => {
    // Anti-vacuity: every assertion below is a substring check against this.
    expect(NAV_LABEL.length).toBeGreaterThan(3);
  });

  it("introduces the nav word in a subtitle a sighted user can actually read", async () => {
    renderList();

    const heading = await screen.findByRole("heading", { level: 1 });
    // Control: the h1 really is hidden, so the subtitle is the only visible
    // place the page can name itself.
    expect(heading).toHaveClass("sr-only");

    const visible = screen
      .getAllByText(new RegExp(`^${NAV_LABEL}\\b`))
      .filter((el) => el.tagName !== "H1" && !el.classList.contains("sr-only"));
    expect(visible).toHaveLength(1);
  });

  it("uses the nav word in the empty state", async () => {
    renderList();
    expect(
      await screen.findByText(new RegExp(`^No ${NAV_LABEL} yet$`, "i")),
    ).toBeInTheDocument();
  });

  it("uses the nav word in the error state", async () => {
    listResult = () => Promise.reject(new Error("boom"));
    renderList();

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`Could not load ${NAV_LABEL}`, "i")),
      ).toBeInTheDocument();
    });
  });

  it("uses the nav word on the loading skeleton", () => {
    // A query that never settles — the honest loading state.
    listResult = () => new Promise<ConnectionSummary[]>(() => {});
    renderList();

    expect(
      screen.getByLabelText(new RegExp(`Loading ${NAV_LABEL}`, "i")),
    ).toBeInTheDocument();
  });

  it("uses the nav word as the browser tab title", () => {
    expect(String(metadata.title)).toMatch(new RegExp(`^${NAV_LABEL}\\b`, "i"));
  });
});
