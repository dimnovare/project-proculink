import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-11 follow-through — /operations/log.
//
// The org-wide audit log is gated at Operations. Below it the API answers 403
// `advanced_audit_requires_operations`, and this page used to render its network-failure
// panel: "Could not load the delivery log. Check your connection and try again." That copy is
// actively wrong — the connection is fine, the plan is the reason — and its Retry button
// re-runs a call that can only 403 again.

const getAuditLog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  // The delivery log now derives an `?orderId=` filter from the URL (WP-24: the
  // "See every attempt" control on a failed order used to land on the whole
  // workspace's log). This mock has to answer useSearchParams or the component
  // throws before any plan-gate copy renders.
  useSearchParams: () => new URLSearchParams(),
}));

import { CrossingsLog } from "./CrossingsLog";

function renderLog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getAuditLog.mockReset();
});

afterEach(cleanup);

describe("CrossingsLog — plan-gated audit log", () => {
  it("explains the plan and links to the upgrade page instead of blaming the connection", async () => {
    getAuditLog.mockRejectedValue(
      new Error(JSON.stringify({ error: "advanced_audit_requires_operations", upgradeUrl: "/settings" })),
    );

    renderLog();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Operations/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|advanced_audit/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
    // The load-failure panel must NOT also be on screen. Asserted by role: the
    // plan gate is role="status" (an explanation of an entitlement, not a fault),
    // the load failure is role="alert".
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still shows the load-failure panel for a failure that is not a plan gate", async () => {
    getAuditLog.mockRejectedValue(new Error("audit: 500"));

    renderLog();

    // role="alert", not a silent <div>: this panel REPLACES the log, so a reader
    // who gets no announcement is left with a page that simply stopped changing.
    const panel = await screen.findByRole("alert");
    expect(panel).toHaveTextContent(/couldn't load the delivery log/i);
    // The copy must not tell the operator to check their connection: the request
    // is equally likely to have been refused server-side (this one is a 500), and
    // that sentence sends someone to reset a router over a backend fault.
    expect(panel.textContent ?? "").not.toMatch(/check your connection/i);
    // And it must not read as "there is nothing here" — the defect class this
    // area keeps meeting is a failed fetch that renders as a confident empty set.
    expect(panel).toHaveTextContent(/not the same as/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
