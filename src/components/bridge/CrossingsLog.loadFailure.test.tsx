import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getAuditLog = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CrossingsLog } from "./CrossingsLog";

afterEach(cleanup);

describe("CrossingsLog — load failure", () => {
  it("shows the load-failure panel with a way to try again", async () => {
    getAuditLog.mockRejectedValue(new Error("audit: 500"));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CrossingsLog />
      </QueryClientProvider>,
    );

    // role="alert": this panel REPLACES the list, so a reader who gets no announcement is left
    // with a page that simply stopped changing.
    const panel = await screen.findByRole("alert");
    expect(panel).toHaveTextContent(/couldn.t load/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // A failed load must never look like an empty list.
    expect(screen.queryByText(/no matching events|nothing recorded/i)).toBeNull();
  });
});
