import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { poTitleFrom, WorkshopGateHeader, WorkshopGateShell } from "./WorkshopGateChrome";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

afterEach(() => {
  cleanup();
  routerPush.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// poTitleFrom — the one shared "PO <number>" derivation (healthy header + every
// gate header). The old inline `/^\s*po\b/i` failed on separator-less "PO12345"
// (no word boundary between "O" and "1") and rendered "PO PO12345".
// ─────────────────────────────────────────────────────────────────────────────
describe("poTitleFrom — prefix detection", () => {
  test.each([
    ["PO-12345", "PO-12345"],
    ["po 12345", "po 12345"],
    ["PO 4091678643", "PO 4091678643"],
  ])("separator-prefixed %s stays unchanged", (input, expected) => {
    expect(poTitleFrom(input)).toBe(expected);
  });

  test("separator-less PO12345 is recognized as already prefixed (regression: was 'PO PO12345')", () => {
    expect(poTitleFrom("PO12345")).toBe("PO12345");
  });

  test("a bare number gets the PO prefix", () => {
    expect(poTitleFrom("4091678643")).toBe("PO 4091678643");
  });

  test("P0123 (P-zero) is NOT a prefix — it gets 'PO ' prepended", () => {
    expect(poTitleFrom("P0123")).toBe("PO P0123");
  });

  test("PORTLAND-7 is NOT a prefix — 'po' is followed by a letter, not a boundary or digit", () => {
    expect(poTitleFrom("PORTLAND-7")).toBe("PO PORTLAND-7");
  });

  test.each([[""], ["   "], [null], [undefined]])(
    "empty/blank/nullish (%s) → 'Order'",
    (input) => {
      expect(poTitleFrom(input as string | null | undefined)).toBe("Order");
    },
  );

  test("leading whitespace before an existing prefix is trimmed, not double-prefixed", () => {
    expect(poTitleFrom("  PO-9 ")).toBe("PO-9");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkshopGateHeader — ← Inbox chip + PO title (the gate's ONE h1) + status
// badge when a status is known.
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkshopGateHeader", () => {
  test("renders the ← Inbox chip and it navigates to /inbox", () => {
    render(<WorkshopGateHeader poNumber="PO-77" status="delivery_held" />);
    const back = screen.getByRole("button", { name: "Back to inbox" });
    expect(back.textContent).toContain("Inbox");
    fireEvent.click(back);
    expect(routerPush).toHaveBeenCalledWith("/inbox");
  });

  test("the PO title is the ONE h1, with the raw number as its hover title", () => {
    render(<WorkshopGateHeader poNumber="4091678643" status="failed" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("PO 4091678643");
    expect(headings[0].getAttribute("title")).toBe("4091678643");
  });

  test("no PO number → the h1 says 'Order' (no fake identity)", () => {
    render(<WorkshopGateHeader />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Order");
  });

  test("a known status renders its canonical badge; no status renders none", () => {
    const { unmount } = render(<WorkshopGateHeader poNumber="PO-1" status="delivery_held" />);
    expect(screen.getByText("Delivery paused")).toBeTruthy();
    unmount();
    render(<WorkshopGateHeader poNumber="PO-1" />);
    expect(screen.queryByText("Delivery paused")).toBeNull();
  });

  test("the h1 carries the truncation styles (nowrap + ellipsis + min-width 0) so long numbers clip gracefully", () => {
    render(<WorkshopGateHeader poNumber="4091678643-A-VERY-LONG-REFERENCE-0001" />);
    const h1 = screen.getByRole("heading", { level: 1 }) as HTMLElement;
    expect(h1.style.whiteSpace).toBe("nowrap");
    expect(h1.style.overflow).toBe("hidden");
    expect(h1.style.textOverflow).toBe("ellipsis");
    expect(h1.style.minWidth).toBe("0"); // React keeps 0 unitless
  });
});

describe("WorkshopGateShell", () => {
  test("wraps children under the context header", () => {
    render(
      <WorkshopGateShell poNumber="PO-5" status="transform_failed">
        <div data-testid="gate-child" />
      </WorkshopGateShell>,
    );
    expect(screen.getByTestId("workshop-gate-shell")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to inbox" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("PO-5");
    expect(screen.getByTestId("gate-child")).toBeTruthy();
  });
});
