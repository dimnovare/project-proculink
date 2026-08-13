// Settings ▸ Email intake must not describe a live IMAP connection it never observed.
//
// THE DEFECT, VERBATIM. The line under "Poll inbox for orders" was
// `{form.enabled ? "Checking every 5 minutes" : "Disabled"}`. `enabled` is a saved boolean, so a
// wrong password, an unreachable host or a stopped Worker all left that sentence on screen
// indefinitely — and because `form` is the dirty form state, merely flipping the switch changed
// it before anything was saved.
//
// The screen already had the answer and rendered it badly: `lastPolledAt` is written by
// `EmailPollOrgJob` only after connect + authenticate + fetch + clean disconnect, and it was
// printed as an absolute `toLocaleString()` timestamp in the footer, leaving the operator to
// notice it was stale and do the arithmetic.
//
// These tests assert the RENDERED SENTENCE for each distinct state, because that is what the
// operator reads. The reading logic itself lives in src/components/settings/pollingHealth.ts.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmailSettings } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=email"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return { ...actual, getInboundAddresses: vi.fn().mockResolvedValue([]) };
});

const BASE_SETTINGS: EmailSettings = {
  enabled: true,
  host: "imap.company.test",
  port: 993,
  useSsl: true,
  username: "orders@company.test",
  folder: "INBOX",
  defaultSupplierId: "sup-1",
  hasPassword: true,
  passwordDisplay: null,
  lastPolledAt: null,
  updatedAt: "2026-08-01T10:00:00Z",
};

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOrgSettings: vi.fn().mockResolvedValue({ slug: "test-org", name: "Test Org" }),
    getEmailSettings: vi.fn(),
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    apiClient: {
      ...actual.apiClient,
      getSuppliers: vi.fn().mockResolvedValue([{ id: "sup-1", name: "Nordmark GmbH" }]),
    },
  };
});

import { getEmailSettings } from "@/lib/api-client";
import SettingsPage from "./page";

/** Minutes/days back from now, so the relative buckets land deterministically. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000).toISOString();

function renderWith(settings: Partial<EmailSettings>) {
  vi.mocked(getEmailSettings).mockResolvedValue({ ...BASE_SETTINGS, ...settings });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Settings — the polling line reports an observed poll, not a saved switch", () => {
  it("enabled + a recent success: states the cadence, and only alongside the evidence", async () => {
    renderWith({ enabled: true, lastPolledAt: minutesAgo(4) });

    expect(
      await screen.findByText("Checking every 5 minutes — last successful check 4m ago."),
    ).toBeInTheDocument();
  });

  it("enabled + never succeeded: says so, and does not claim it is checking", async () => {
    renderWith({ enabled: true, lastPolledAt: null });

    expect(
      await screen.findByText(
        "Polling is on, but no check has succeeded yet — ProcuLink cannot confirm this mailbox is being read.",
      ),
    ).toBeInTheDocument();
    // The exact sentence the defect shipped. It must not survive anywhere on the screen.
    expect(screen.queryByText(/Checking every 5 minutes/)).not.toBeInTheDocument();
  });

  it("enabled + a stale success: names the age and withdraws the claim", async () => {
    renderWith({ enabled: true, lastPolledAt: daysAgo(3) });

    expect(
      await screen.findByText("Last successful check 3d ago — polling may not be working."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Checking every 5 minutes/)).not.toBeInTheDocument();
  });

  it("enabled + an unreadable stamp: renders as unreadable, never as never and never as healthy", async () => {
    renderWith({ enabled: true, lastPolledAt: "not-a-date" });

    expect(
      await screen.findByText("Polling is on, but ProcuLink cannot read when this mailbox was last checked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no check has succeeded yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checking every 5 minutes/)).not.toBeInTheDocument();
  });

  it("disabled: says the mailbox is not being checked, and keeps the last success as a fact", async () => {
    renderWith({ enabled: false, lastPolledAt: daysAgo(2) });

    expect(
      await screen.findByText("Off — this mailbox is not being checked. Last successful check 2d ago."),
    ).toBeInTheDocument();
  });

  it("an unsaved switch describes nobody's behaviour yet", async () => {
    renderWith({ enabled: false, lastPolledAt: null });
    await screen.findByText("Off — this mailbox is not being checked.");

    fireEvent.click(screen.getByRole("switch", { name: "Poll inbox for orders" }));

    expect(
      await screen.findByText("Not saved yet — this mailbox is not being checked until you save."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Checking every 5 minutes/)).not.toBeInTheDocument();
  });

  // The footer carried the same over-claim in miniature: a null stamp printed "not run yet",
  // which asserts a poll never happened. The Worker writes nothing on failure, so a mailbox
  // failing every 5 minutes for a week produces exactly this null.
  it("omits the exact-timestamp footer rather than calling a null stamp 'not run yet'", async () => {
    renderWith({ enabled: true, lastPolledAt: null });
    await screen.findByText(/no check has succeeded yet/);

    expect(screen.queryByText(/not run yet/)).not.toBeInTheDocument();
    expect(screen.getByText("Passwords are stored encrypted.")).toBeInTheDocument();
  });

  it("keeps the exact instant available when there is a readable stamp", async () => {
    renderWith({ enabled: true, lastPolledAt: "2026-08-01T10:05:00Z" });

    expect(await screen.findByText(/Last successful check: 1 Aug 2026, /)).toBeInTheDocument();
  });
});
