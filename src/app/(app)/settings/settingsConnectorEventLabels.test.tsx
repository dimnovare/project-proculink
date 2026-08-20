// Settings → Notifications must describe webhook events in plain language.
//
// The EVENT_LABELS map on this page existed but was never rendered: the event
// dropdown listed three hardcoded <option>s carrying the bare code, and the
// saved-endpoint rows printed the bare code too. The friendly copy only ever
// shipped on /operations/webhooks, which was deleted in FE #130 as an
// unreachable duplicate of this screen, so Settings became the only surface and
// it showed the less helpful text.
//
// Both surfaces now read EVENT_LABELS, and both keep the literal event code on
// screen — the help article (help/api-and-integrations) documents the codes
// verbatim, so a developer wiring up an integration has to be able to correlate
// what they read there with what they pick here.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=connectors"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    getIntegrations: vi.fn().mockResolvedValue([
      {
        id: "sub-1",
        platform: "zapier",
        eventType: "order.created",
        targetUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
        isActive: true,
        failureCount: 0,
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      },
    ]),
  };
});

import { getIntegrations } from "@/lib/api-client";
import {
  INTEGRATION_EVENT_LABELS,
  SUBSCRIBABLE_INTEGRATION_EVENTS,
} from "@/lib/integrationEventManifest";
import SettingsPage from "./page";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings — Notifications describes webhook events in plain language", () => {
  it("shows a saved endpoint's event as a description alongside its literal code", async () => {
    renderSettings();

    // The description is what an operator reads…
    expect(await screen.findByText("New PO uploaded or received")).toBeInTheDocument();
    // …and the literal code stays on screen for whoever is verifying the payload.
    expect(screen.getByText("order.created")).toBeInTheDocument();
  });

  it("offers every event in the create form with both its code and its description", async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /add webhook/i }));

    // Scoped to the Event select — the Platform select next to it has options too.
    const eventSelect = screen.getByLabelText("Event") as HTMLSelectElement;
    const options = Array.from(eventSelect.options).map((o) => o.textContent?.replace(/\s+/g, " ").trim());

    // Derived from the manifest that mirrors the backend allow-list
    // (src/lib/integrationEventManifest.ts) — this assertion used to pin a
    // hand-typed three-entry list, which is exactly how the menu stayed at
    // three while the backend grew to five (order.rejected and
    // order.dead_lettered could be delivered but never subscribed to).
    // integrationEventManifest.test.tsx carries the >= 5 anti-vacuity floor.
    expect(options).toEqual(
      SUBSCRIBABLE_INTEGRATION_EVENTS.map(
        (event) => `${event} — ${INTEGRATION_EVENT_LABELS[event]}`,
      ),
    );
  });

  it("says nothing about an event type it has no description for", async () => {
    // A backend that starts sending a fourth event must not have it captioned
    // with whichever description happens to be first in the map.
    vi.mocked(getIntegrations).mockResolvedValueOnce([
      {
        id: "sub-2",
        platform: "custom",
        eventType: "order.acknowledged",
        targetUrl: "https://example.test/hook",
        isActive: true,
        failureCount: 0,
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      },
    ]);
    renderSettings();

    // The literal code still renders, so the row is never anonymous…
    expect(await screen.findByText("order.acknowledged")).toBeInTheDocument();
    // …but no description is invented for it.
    for (const description of Object.values(INTEGRATION_EVENT_LABELS)) {
      expect(screen.queryByText(description)).not.toBeInTheDocument();
    }
  });
});
