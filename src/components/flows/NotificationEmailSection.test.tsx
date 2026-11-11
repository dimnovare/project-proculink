import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationEmailSection } from "./NotificationEmailSection";

const api = vi.hoisted(() => ({ getNotificationSettings: vi.fn(), saveNotificationSettings: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useDocumentEngine", () => ({ useDocumentEngine: () => "on" }));

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NotificationEmailSection />
  </QueryClientProvider>,
);

describe("NotificationEmailSection", () => {
  it("shows the email, and saves a toggled switch", async () => {
    api.getNotificationSettings.mockResolvedValue({ email: "a@b.test", onReview: false, onFailure: false });
    api.saveNotificationSettings.mockResolvedValue({ email: "a@b.test", onReview: false, onFailure: true });
    mount();
    expect(await screen.findByText("Emails go to a@b.test, at most one every 15 minutes.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Email me" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("When a document can't be read or sent"));
    await waitFor(() => expect(api.saveNotificationSettings).toHaveBeenCalledWith({ onReview: false, onFailure: true }));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("renders nothing when the email is unknown", async () => {
    api.getNotificationSettings.mockResolvedValue({ email: null, onReview: false, onFailure: false });
    const { container } = mount();
    await waitFor(() => expect(api.getNotificationSettings).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
