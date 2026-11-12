import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("refuses a half-filled login and does not call the API", () => {
    api.updateDestination.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={saved} onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Sign in with"), { target: { value: "basic" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Fill in every login field/)).toBeTruthy();
    expect(api.updateDestination).not.toHaveBeenCalled();
  });

  it("offers an email subject and message but no attachment file name, which a flow send ignores", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(within(container).getByLabelText("Send by"), { target: { value: "email" } });
    expect(within(container).getByLabelText("Subject")).toBeTruthy();
    expect(within(container).getByLabelText("Message")).toBeTruthy();
    expect(within(container).queryByLabelText(/attachment/i)).toBeNull();
  });

  it("takes an SFTP private key in a textarea that keeps its line breaks, and does not show it after saving", async () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----\n";
    api.createDestination.mockResolvedValue({ ...saved, id: "d2", protocol: "sftp", config: {} });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    const ui = within(container);
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "sftp" } });
    fireEvent.change(ui.getByLabelText("Name"), { target: { value: "Files" } });
    fireEvent.change(ui.getByLabelText("Username"), { target: { value: "ops" } });
    const box = ui.getByLabelText("Private key (instead of password)") as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");
    fireEvent.change(box, { target: { value: key } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalled());
    expect(api.createDestination.mock.calls[0][0].credentials).toEqual({ username: "ops", privateKey: key });
    await waitFor(() => expect(box.value).toBe(""));
  });
});
