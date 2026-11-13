import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GoogleCallbackPage from "./page";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const linked = vi.hoisted(() => ({ completeGoogleConnect: vi.fn() }));
vi.mock("@/lib/api/linkedAccounts", () => linked);

const mount = () => within(render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <GoogleCallbackPage />
    </QueryClientProvider>
  </StrictMode>,
).container);

afterEach(() => {
  vi.restoreAllMocks();
  linked.completeGoogleConnect.mockReset();
  Object.defineProperty(window, "opener", { value: null, configurable: true });
});

describe("Google callback page", () => {
  it("exchanges the code once under StrictMode's double mount, then tells the opener", async () => {
    nav.search = "?code=c1&state=s1";
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    linked.completeGoogleConnect.mockResolvedValue({ account: { id: "acc-1" }, returnTo: "/flows/f1" });
    const ui = mount();
    expect(await ui.findByText("Google account connected. You can close this window.")).toBeTruthy();
    expect(linked.completeGoogleConnect).toHaveBeenCalledTimes(1);
    expect(linked.completeGoogleConnect).toHaveBeenCalledWith("c1", "s1");
    expect(postMessage).toHaveBeenCalledWith({ type: "proculink:google-connected" }, location.origin);
    expect(close).toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("shows the not-granted copy and calls nothing when the user declined", async () => {
    nav.search = "?error=access_denied&state=s1";
    const ui = mount();
    expect(ui.getByText("Google access was not granted. Close this window and try again.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(linked.completeGoogleConnect).not.toHaveBeenCalled();
  });
});
