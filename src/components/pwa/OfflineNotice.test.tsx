import { act, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfflineNotice } from "./OfflineNotice";

afterEach(() => vi.restoreAllMocks());

it("fills the status region when the connection drops and empties it when it returns", () => {
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  render(<OfflineNotice />);
  const region = screen.getByTestId("offline-notice");
  expect(region).toHaveAttribute("role", "status");
  expect(region).toBeEmptyDOMElement();
  onLine.mockReturnValue(false);
  act(() => { window.dispatchEvent(new Event("offline")); });
  expect(within(region).getByText("You're offline. Showing what was loaded last.")).toBeInTheDocument();
  onLine.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("online")); });
  expect(region).toBeEmptyDOMElement();
});
