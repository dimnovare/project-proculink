import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within, fireEvent, waitFor } from "@testing-library/react";
const nav = vi.hoisted(() => ({ path: "/documents" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
const pages = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/components/help/helpPages", () => ({ loadHelpPage: pages.load }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
import { HelpPanel, HelpPanelProvider, useHelpPanel } from "./HelpPanel";
import { AppNotFound } from "./AppNotFound";

function Opener() { const help = useHelpPanel(); return <button type="button" onClick={help.toggle} aria-expanded={help.open}>Help</button>; }
const shell = (page = <Opener />) => render(<HelpPanelProvider><main>{page}</main><HelpPanel /></HelpPanelProvider>);

beforeEach(() => { nav.path = "/documents"; pages.load.mockReset(); });

describe("HelpPanel", () => {
  it("opens beside the page without covering it; Escape closes it and focus goes back to what opened it", async () => {
    const { container } = shell();
    const opener = within(container).getByRole("button", { name: "Help" });
    opener.focus();
    fireEvent.click(opener);
    const panel = within(container).getByRole("complementary", { name: "Help" });
    expect(panel.id).toBe("help-panel");
    expect(within(container).queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    // The hook moves focus on the next animation frame.
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByLabelText("Search help articles")));
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(container).queryByRole("complementary", { name: "Help" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("opens a task's article inside the panel, and says so with a link when it cannot", async () => {
    pages.load.mockResolvedValueOnce({ default: () => <p>Article body</p> });
    const { container } = shell();
    fireEvent.click(within(container).getByRole("button", { name: "Help" }));
    const panel = within(container).getByRole("complementary", { name: "Help" });
    const tasks = within(panel).getByRole("region", { name: "Help for this screen" });
    expect(within(tasks).getByText("Documents")).toBeTruthy();
    const links = within(tasks).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining('What "Needs you" means'),
      expect.stringContaining("Review and send a document"),
      expect.stringContaining("Find an older document"),
    ]);
    fireEvent.click(links[0]);
    expect(pages.load).toHaveBeenCalledWith("/help/documents-and-statuses");
    expect(await within(panel).findByText("Article body")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Open in the help centre" }).getAttribute("target")).toBe("_blank");
    fireEvent.click(within(panel).getByRole("button", { name: "Back to help" }));
    pages.load.mockRejectedValueOnce(new Error("chunk"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(within(within(panel).getByRole("region", { name: "Help for this screen" })).getAllByRole("link")[1]);
    expect(await within(panel).findByText("We couldn't open this article.")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Open it in the help centre" }).getAttribute("href")).toBe("/help/guides/check-and-send-a-document");
  });

  it("an address with no help (opened from page not found) shows search, popular articles and the three links, and nothing about this screen", () => {
    nav.path = "/archive";
    const { container } = shell(<AppNotFound />);
    fireEvent.click(within(container).getByRole("button", { name: "Get help" }));
    const panel = within(container).getByRole("complementary", { name: "Help" });
    expect(within(panel).queryByText("On this screen")).toBeNull();
    expect(within(panel).queryByText("Start here")).toBeNull();
    const popular = within(panel).getByRole("region", { name: "Popular articles" });
    expect(within(popular).getAllByRole("link")).toHaveLength(3);
    expect(within(popular).getAllByText(/^\d+ minute read$/)).toHaveLength(3);
    const foot = within(panel).getByRole("navigation", { name: "Help links" });
    expect(within(foot).getAllByRole("link").map((a) => a.textContent)).toEqual(["Open help centre", "Contact support", "Report a problem"]);
  });
});
