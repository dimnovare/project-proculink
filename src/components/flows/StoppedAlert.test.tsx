import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DocumentPage, DocumentRow } from "@/lib/api/documents";
import { StoppedAlert } from "./StoppedAlert";

const stopped = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "d1", flowId: "f1", flowName: "Supplier invoices", fileName: "invoice-2291.pdf", status: "send_failed", statusReason: null,
  pageCount: null, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-02T09:00:00Z", source: "upload", sourceRef: null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: "2026-11-02T09:12:00Z", stop: null, isSample: false, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T09:24:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("StoppedAlert", () => {
  it("names the destination when every stopped document stopped at the same one", () => {
    const stop = { destinationId: "dest-1", destination: "Accounting server", error: "The server refused the login." };
    render(<StoppedAlert page={{ items: [stopped({ stop })], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 }} />);
    const alert = screen.getByRole("alert");
    // What the eye reads: the screen-reader-only time left out.
    const seen = alert.cloneNode(true) as HTMLElement;
    seen.querySelectorAll(".sr-only").forEach((e) => e.remove());
    expect(seen).toHaveTextContent("1 document couldn't be sent. Sending to Accounting server stopped 12m ago: The server refused the login. The document is safe. Fix the destination, then send it again.");
    // The live alert must not be re-announced each minute: the relative time is hidden, a fixed moment is read instead.
    expect(within(alert).getByText("12m ago")).toHaveAttribute("aria-hidden", "true");
    const at = new Date("2026-11-02T09:12:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    expect(alert.querySelector(".sr-only")).toHaveTextContent(`on ${at}`);
    expect(within(alert).getByRole("link", { name: "Fix the destination" })).toHaveAttribute("href", "/flows/f1?tab=outputs");
    cleanup();
    // A server sentence with no full stop gets one, and nothing else.
    render(<StoppedAlert page={{ items: [stopped({ stop: { ...stop, error: "Refused" } })], totalCount: 1, page: 1, pageSize: 20, sampleCount: 0 }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/: Refused\. The document is safe\./);
  });

  it("stays general when there is no single destination to name", () => {
    const a = { destinationId: "dest-1", destination: "Accounting server", error: "Refused." };
    const cases: DocumentPage[] = [
      { items: [stopped({ stop: a }), stopped({ id: "d2", stop: { ...a, destinationId: "dest-2" } })], totalCount: 2, page: 1, pageSize: 20, sampleCount: 0 },
      { items: [stopped({ stop: null }), stopped({ id: "d2", stop: { ...a, destination: null } })], totalCount: 2, page: 1, pageSize: 20, sampleCount: 0 },
      { items: [stopped({ stop: a }), stopped({ id: "d2", stop: a })], totalCount: 40, page: 1, pageSize: 20, sampleCount: 0 }, // more than were read
      // One destination id, but no name left to give.
      { items: [stopped({ stop: { ...a, destination: null } }), stopped({ id: "d2", stop: { ...a, destination: null } })], totalCount: 2, page: 1, pageSize: 20, sampleCount: 0 },
    ];
    for (const page of cases) {
      const { unmount } = render(<StoppedAlert page={page} />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(`${page.totalCount} documents couldn't be sent. The documents are safe. Open them to see what happened, then send them again.`);
      expect(alert.textContent).not.toMatch(/null|undefined|Sending to/);
      expect(within(alert).getByRole("link", { name: "Show what couldn't be sent" })).toHaveAttribute("href", "/documents?show=failed");
      unmount();
    }
    expect(render(<StoppedAlert page={undefined} />).container).toBeEmptyDOMElement();
    expect(render(<StoppedAlert page={{ items: [], totalCount: 0, page: 1, pageSize: 20, sampleCount: 0 }} />).container).toBeEmptyDOMElement();
  });
});
