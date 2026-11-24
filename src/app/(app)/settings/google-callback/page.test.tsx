import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GoogleCallbackPage from "./page";
import OutlookCallbackPage from "../outlook-callback/page";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const linked = vi.hoisted(() => ({ completeGoogleConnect: vi.fn(), completeOutlookConnect: vi.fn() }));
vi.mock("@/lib/api/linkedAccounts", async (original) => ({
  ...(await original<typeof import("@/lib/api/linkedAccounts")>()),
  completeGoogleConnect: linked.completeGoogleConnect,
  completeOutlookConnect: linked.completeOutlookConnect,
}));

const posts: { name: string; data: unknown }[] = [];
vi.stubGlobal("BroadcastChannel", class {
  constructor(private name: string) {}
  postMessage(data: unknown) { posts.push({ name: this.name, data }); }
  close() {}
});

const mount = (Page: () => React.ReactNode = GoogleCallbackPage) => within(render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>
  </StrictMode>,
).container);

afterEach(() => {
  vi.restoreAllMocks();
  linked.completeGoogleConnect.mockReset();
  linked.completeOutlookConnect.mockReset();
  nav.replace.mockReset();
  posts.length = 0;
});

describe.each([
  ["google", GoogleCallbackPage, () => linked.completeGoogleConnect, "Google account connected. You can close this window."],
  ["outlook", OutlookCallbackPage, () => linked.completeOutlookConnect, "Microsoft mailbox connected. You can close this window."],
] as const)("%s callback page", (_provider, Page, complete, connected) => {
  it("exchanges the code once under StrictMode's double mount, announces it, and closes the popup", async () => {
    nav.search = "?code=c1&state=s1";
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    complete().mockResolvedValue({ account: { id: "acc-1" }, returnTo: null });
    const ui = mount(Page);
    expect(await ui.findByText(connected)).toBeTruthy();
    expect(complete()).toHaveBeenCalledTimes(1);
    expect(complete()).toHaveBeenCalledWith("c1", "s1");
    expect(posts).toEqual([{ name: "proculink:google-connect", data: { type: "connected" } }]);
    expect(close).toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("Google callback page", () => {

  it("never follows a returnTo a browser would read as another site", async () => {
    nav.search = "?code=c2&state=s2";
    linked.completeGoogleConnect.mockResolvedValue({ account: { id: "acc-1" }, returnTo: "/\t/evil.example" });
    mount();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/flows"));
  });

  it("shows the not-granted copy and calls nothing when the user declined: a whole tab goes back to destinations", async () => {
    nav.search = "?error=access_denied&state=s1";
    const ui = mount();
    expect(ui.getByText("Google access was not granted, so nothing was connected.")).toBeTruthy();
    expect(ui.getByRole("link", { name: "Back to destinations" }).getAttribute("href")).toBe("/settings?tab=destinations");
    expect(ui.queryByRole("button", { name: "Close" })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(linked.completeGoogleConnect).not.toHaveBeenCalled();
  });

  it("a declined popup says to close it, with a Close button", async () => {
    nav.search = "?error=access_denied&state=s1";
    Object.defineProperty(window, "opener", { value: {}, configurable: true, writable: true });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const ui = mount();
    expect(await ui.findByText("Google access was not granted. Close this window and try again.")).toBeTruthy();
    ui.getByRole("button", { name: "Close" }).click();
    expect(close).toHaveBeenCalled();
    expect(ui.queryByRole("link", { name: "Back to destinations" })).toBeNull();
    window.opener = null;
  });
});

describe("Outlook callback page", () => {
  it("says an admin may have to approve ProcuLink when Microsoft refused, and exchanges nothing", async () => {
    nav.search = "?error=access_denied&state=s";
    const ui = mount(OutlookCallbackPage);
    expect(ui.getByText(
      "Microsoft access was not granted. If your organization's Microsoft 365 admin must approve new apps, ask them to approve ProcuLink, then try again.",
    )).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(linked.completeOutlookConnect).not.toHaveBeenCalled();
  });
});
