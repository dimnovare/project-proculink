import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Destination } from "@/lib/api/documents";
import { DestinationForm } from "./DestinationForm";

const api = vi.hoisted(() => ({
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  testDestination: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const saved: Destination = {
  id: "d1", name: "Accounting", protocol: "http", hasCredentials: true, createdAt: "2026-11-01T00:00:00Z",
  config: { url: "https://example.test/in", method: "POST", timeoutSeconds: 30, headers: { "X-Org": "a" } },
};

describe("DestinationForm", () => {
  it("keeps saved credentials and the config when only the name changes, then sends a test", async () => {
    api.updateDestination.mockResolvedValue({ ...saved, name: "Books" });
    api.testDestination.mockResolvedValue({ success: true, message: "Receiver answered 200.", responseCode: 200 });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={saved} onSaved={onSaved} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Saved")).toBeTruthy();
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Books" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateDestination).toHaveBeenCalledWith("d1", {
      name: "Books", protocol: "http", config: saved.config, credentials: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Receiver answered 200.")).toBeTruthy();
    expect(api.testDestination).toHaveBeenCalledWith("d1");
  });
});
