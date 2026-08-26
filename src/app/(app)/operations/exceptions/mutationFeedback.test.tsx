import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// /operations/exceptions — the list mutations must say what happened.
//
// THE DEFECT THIS PINS, verbatim. Both mutations were exactly this and nothing else:
//
//     const resolveMut = useMutation({
//       mutationFn: (id: string) => resolveException(id),
//       onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
//     });
//
// No `onError`. `PATCH /api/exceptions/{id}/resolve` throws on any non-2xx
// (src/lib/api/operations.ts:258), TanStack caught it, `pendingId` cleared, the button
// re-enabled, and the row was unchanged with nothing said. From the operator's chair a
// refused Resolve was indistinguishable from a click that never registered — on the one
// screen whose job is "every order that needs a human decision before it can be sent".
//
// The page also had NO live region anywhere, so even a message added without the right
// role would have gone unannounced. Both halves are asserted here: the text appears, and
// it appears with the semantics its severity demands.
//
// DIRECTION MATTERS. A fix that showed a banner for every outcome in one colour would
// satisfy "says something" while re-introducing the failure this repo keeps meeting — a
// failure that reads as a success. So the failure assertions below check the ROLE and the
// tone attribute, not merely the presence of text, and the success case is checked to be
// a different tone from the failure case rather than just "some tone".

import ExceptionsPage from "./page";
import type { OrderException } from "@/types/procurement";

const getExceptions = vi.fn();
const resolveException = vi.fn();
const ignoreException = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => push(...args), replace: vi.fn() }),
  usePathname: () => "/operations/exceptions",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    isApiMockMode: false,
    getExceptions: (...args: unknown[]) => getExceptions(...args),
    resolveException: (...args: unknown[]) => resolveException(...args),
    ignoreException: (...args: unknown[]) => ignoreException(...args),
  };
});

afterEach(() => {
  cleanup();
  getExceptions.mockReset();
  resolveException.mockReset();
  ignoreException.mockReset();
  push.mockReset();
});

/**
 * One actionable, order-less exception.
 *
 * `orderId: null` is load-bearing: the page offers a real "Resolve" only for a
 * list-clearable exception (one with no owning order) — for an order-linked row the
 * primary action is "Open order", because the backend Reconcile pass would re-open a
 * manually resolved one. So a row with an order would render no Resolve button to click.
 */
function clearableRow(): OrderException {
  return {
    id: "exc-0",
    orderId: null,
    lineId: null,
    stage: "deliver",
    code: "CODE_0",
    severity: "error",
    message: "Message 0",
    state: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

async function renderPage(): Promise<HTMLElement> {
  getExceptions.mockResolvedValue([clearableRow()]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExceptionsPage />
    </QueryClientProvider>,
  );
  const nodes = await screen.findAllByText("Message 0");
  const table = nodes.map((n) => n.closest("table")).find((t): t is HTMLTableElement => t !== null);
  if (!table) throw new Error("the exceptions page rendered no desktop table");
  return table;
}

/** Clicks the named control in the desktop table (the mobile list renders too). */
function clickInTable(table: HTMLElement, name: RegExp): void {
  const button = within(table).getByRole("button", { name });
  fireEvent.click(button);
}

describe("exceptions — a refused mutation is visible and announced", () => {
  it("floor: the row really offers the controls these tests click", async () => {
    // Without this, every "the failure is shown" assertion below could pass because
    // nothing was ever clicked and nothing was ever going to be.
    const table = await renderPage();
    expect(within(table).getByRole("button", { name: /resolve/i })).toBeTruthy();
    expect(within(table).getByRole("button", { name: /ignore/i })).toBeTruthy();
  });

  it("shows the server's own sentence when Resolve is refused", async () => {
    const table = await renderPage();
    resolveException.mockRejectedValue(new Error("This issue belongs to another workspace."));

    clickInTable(table, /resolve/i);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This issue belongs to another workspace.");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
  });

  it("shows the server's own sentence when Ignore is refused", async () => {
    const table = await renderPage();
    ignoreException.mockRejectedValue(new Error("This issue belongs to another workspace."));

    clickInTable(table, /ignore/i);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This issue belongs to another workspace.");
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
  });

  it("falls back to copy that says the issue is UNCHANGED when the error carries no sentence", async () => {
    // An error with an unreadable message is the case the fallback exists for. The
    // fallback must not imply the row was dealt with — that is the whole defect class.
    const table = await renderPage();
    resolveException.mockRejectedValue(new Error(""));

    clickInTable(table, /resolve/i);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unchanged/i);
    expect(alert.getAttribute("data-notice-tone")).toBe("error");
  });

  it("announces a failure assertively, not politely", async () => {
    const table = await renderPage();
    resolveException.mockRejectedValue(new Error("Refused."));

    clickInTable(table, /resolve/i);

    const alert = await screen.findByRole("alert");
    // role="alert" implies an assertive live region. A polite one would queue the
    // message behind whatever else is speaking, which for "your action did not
    // happen" is the wrong end of the queue.
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("aria-live")).toBeNull();
    // And it must not have been quietly filed as a status.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("exceptions — a success is not dressed as a failure, or vice versa", () => {
  it("reports a successful Resolve in a different tone from a refused one", async () => {
    const table = await renderPage();
    resolveException.mockResolvedValue(undefined);

    clickInTable(table, /resolve/i);

    const ok = await screen.findByRole("status");
    expect(ok.getAttribute("data-notice-tone")).toBe("success");
    // Floor + direction: the success path must not be rendering the error role.
    expect(screen.queryByRole("alert")).toBeNull();

    const successTone = ok.getAttribute("data-notice-tone");
    cleanup();

    const table2 = await renderPage();
    resolveException.mockRejectedValue(new Error("Refused."));
    clickInTable(table2, /resolve/i);
    const bad = await screen.findByRole("alert");
    expect(bad.getAttribute("data-notice-tone")).not.toBe(successTone);
  });

  it("says the ignored issue will not be reopened", async () => {
    // The copy has to be true: `ignored` is the one genuinely terminal state —
    // ReconcileAsync never auto-resolves or reopens an ignored row.
    const table = await renderPage();
    ignoreException.mockResolvedValue(undefined);

    clickInTable(table, /ignore/i);

    await waitFor(async () => {
      const ok = await screen.findByRole("status");
      expect(ok).toHaveTextContent(/won't be reopened|won’t be reopened/i);
    });
  });
});
