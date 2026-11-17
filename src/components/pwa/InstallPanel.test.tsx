import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The install module keeps its state for the page's life, so each test imports a fresh copy.
async function fresh() {
  vi.resetModules();
  const [{ InstallPanel }, { INSTALL_DISMISSED_KEY }] = await Promise.all([import("./InstallPanel"), import("@/lib/pwa/install")]);
  return { InstallPanel, INSTALL_DISMISSED_KEY };
}

const realMatchMedia = window.matchMedia;
function standalone(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

it("offers the browser's install only when pressed, and remembers a refusal on this device", async () => {
  const { InstallPanel, INSTALL_DISMISSED_KEY } = await fresh();
  const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  window.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(ev.prompt).not.toHaveBeenCalled();
  render(<InstallPanel />);
  const panel = within(screen.getByTestId("install-panel"));
  expect(panel.getByRole("heading", { name: "Use ProcuLink like an app" })).toBeInTheDocument();
  fireEvent.click(panel.getByRole("button", { name: "Install ProcuLink" }));
  expect(ev.prompt).toHaveBeenCalledTimes(1);
  expect(await panel.findByText("Not installed. You can still install it from your browser's menu.")).toBeInTheDocument();
  expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe("1");
  expect(panel.queryByRole("button")).toBeNull();
});

it("in the installed app it says so and offers nothing; elsewhere without a prompt it explains the iPhone steps in words", async () => {
  standalone(true);
  let { InstallPanel } = await fresh();
  const first = render(<InstallPanel />);
  let panel = within(screen.getByTestId("install-panel"));
  expect(panel.getByText("You're using ProcuLink as an app on this device.")).toBeInTheDocument();
  expect(panel.queryByRole("button")).toBeNull();
  expect(panel.queryByText(/On an iPhone/)).toBeNull();
  first.unmount();

  standalone(false);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  ({ InstallPanel } = await fresh());
  render(<InstallPanel />);
  panel = within(screen.getByTestId("install-panel"));
  expect(panel.getByText("On an iPhone: tap Share, then Add to Home Screen.")).toBeInTheDocument();
  expect(panel.getByText("On Android, once it's installed, ProcuLink is in the Share menu of your other apps.")).toBeInTheDocument();
  expect(panel.queryByRole("button")).toBeNull();
});
