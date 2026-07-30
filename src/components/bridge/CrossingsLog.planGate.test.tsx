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
    expect(screen.queryByText(/Check your connection/i)).toBeNull();
  });

  it("still shows the network-failure panel for a failure that is not a plan gate", async () => {
    getAuditLog.mockRejectedValue(new Error("audit: 500"));

    renderLog();

    expect(await screen.findByText(/Check your connection/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });
});
