import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GlobalError from "./global-error";

vi.mock("@/lib/sentry-context", () => ({ captureException: vi.fn() }));

// Next omits `reset` when it renders this boundary from the server error shell
// (seen on iOS 15): "Try again" threw "reset is not a function" and did nothing.
describe("GlobalError Try again", () => {
  it("calls reset when Next passes it, and reloads when it does not", () => {
    const reset = vi.fn();
    const { unmount } = render(<GlobalError error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    unmount();

    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<GlobalError error={new Error("x")} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
