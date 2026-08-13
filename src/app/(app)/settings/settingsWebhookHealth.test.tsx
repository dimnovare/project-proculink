// Settings ▸ Notifications must not wear a green "Active" pill it never earned.
//
// THE DEFECT, VERBATIM. The row rendered a green dot and the word "Active" for
// `sub.isActive && sub.failureCount === 0`. `failureCount` is a CONSECUTIVE-failure streak —
// `FireIntegrationTriggerJob` resets it to 0 on every 2xx and increments it only on the final
// attempt — so a webhook failing half the time wore the green pill whenever the most recent
// delivery happened to land. And because `IntegrationSubscription` has no last-delivered column,
// `failureCount === 0` cannot separate "the last delivery succeeded" from "nothing has ever been
// sent": a URL typo'd at creation was green from the moment it was saved.
//
// The same ternary had a `null` arm for `isActive && failureCount > 0`, so the state most worth
// naming — a failing subscription — showed neither "Active" nor "Paused".
//
// These tests assert the RENDERED SENTENCE per state. The reading lives in
// src/components/settings/webhookHealth.ts.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IntegrationSubscription } from "@/lib/api-client";

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
    getIntegrations: vi.fn(),
  };
});

import { getIntegrations } from "@/lib/api-client";
import SettingsPage from "./page";

const BASE_SUB: IntegrationSubscription = {
  id: "sub-1",
  platform: "zapier",
  eventType: "order.created",
  targetUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
  isActive: true,
  failureCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

function renderWith(sub: Partial<IntegrationSubscription>) {
  vi.mocked(getIntegrations).mockResolvedValue([{ ...BASE_SUB, ...sub }]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings — a webhook row states the setting, never an unobserved delivery", () => {
  // The never-fired and the last-one-succeeded cases are the SAME row of data. That they cannot
  // be told apart is exactly what the sentence has to admit.
  it("on with no failure streak: refuses to claim events are arriving", async () => {
    renderWith({ isActive: true, failureCount: 0 });

    expect(
      await screen.findByText(
        "Enabled, with no recent failures. ProcuLink does not record successful deliveries, so it cannot confirm events are arriving.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    // The word the defect shipped, and the claim it made.
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("on with a failure streak: gets a badge at all, and the streak read as a streak", async () => {
    renderWith({ isActive: true, failureCount: 3 });

    // The neither-badge hole: this row used to render no status badge whatsoever.
    expect(await screen.findByText("Failing")).toBeInTheDocument();
    expect(
      screen.getByText("The last 3 delivery attempts to this URL failed in a row."),
    ).toBeInTheDocument();
    // "3 failures" read as a lifetime total. It is a consecutive run.
    expect(screen.queryByText("3 failures")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("a single failure reads as one attempt, not as a plural count", async () => {
    renderWith({ isActive: true, failureCount: 1 });

    expect(await screen.findByText("The last delivery attempt to this URL failed.")).toBeInTheDocument();
  });

  it("paused: says no events are being sent", async () => {
    renderWith({ isActive: false, failureCount: 0 });

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Paused — ProcuLink is not sending events to this URL.")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("an unreadable failure count falls to an admission, not to the favourable reading", async () => {
    renderWith({ isActive: true, failureCount: Number.NaN });

    expect(
      await screen.findByText(
        "Enabled. ProcuLink cannot read this URL's recent delivery result, so it cannot confirm events are arriving.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
