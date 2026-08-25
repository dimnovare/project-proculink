import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderDirection } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// The buyers page defined "buyer" with the other direction's sentence.
//
// Both places this page explains the noun — the empty state and the "New buyer"
// panel subtitle — said a buyer is an organization that SENDS YOU purchase
// orders. That is the INBOUND reading. ProcuLink's primary direction is outbound:
// the workspace issues the orders, and the buyer on each one is read off the
// uploaded document. So the page contradicted the org's own setup answer, and it
// imported nothing from the direction hook that exists to prevent exactly this.
//
// The expected strings are derived from `buyerDescription` — the helper that owns
// the wording — rather than typed here, so this file pins the WIRING (page reads
// the org's direction) and cannot drift from the copy it is checking.
// ─────────────────────────────────────────────────────────────────────────────

let directionValue: OrderDirection = "outbound";
let directionKnown = true;

vi.mock("@/hooks/useOrderDirection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOrderDirection")>();
  return {
    ...actual,
    useOrderDirection: () => ({
      direction: directionValue,
      labels: actual.partyLabels(directionValue),
      isDirectionKnown: directionKnown,
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/library/buyers",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  getBuyers: () => Promise.resolve([]),
  createBuyer: vi.fn(),
  deleteBuyer: vi.fn(),
}));

import BuyersPage from "./page";
import { buyerDescription } from "@/hooks/useOrderDirection";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <BuyersPage />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

/** Open the "New buyer" panel from the empty state so its subtitle renders. */
function openNewBuyerPanel() {
  act(() => {
    // Two of them: the page-header action and the empty state's own CTA.
    screen.getAllByRole("button", { name: "New buyer" })[0].click();
  });
}

beforeEach(() => {
  directionValue = "outbound";
  directionKnown = true;
});

afterEach(() => cleanup());

describe("buyerDescription — the three answers are actually different", () => {
  it("gives outbound, inbound and not-yet-known distinct sentences", () => {
    const out = buyerDescription("outbound");
    const inb = buyerDescription("inbound");
    const unknown = buyerDescription(null);

    expect(new Set([out.long, inb.long, unknown.long]).size).toBe(3);
    expect(new Set([out.short, inb.short, unknown.short]).size).toBe(3);
    // The defect in one line: the outbound reader must not be told the buyer
    // sends orders TO them.
    expect(out.long).not.toMatch(/sends you/i);
    expect(inb.long).toMatch(/sends you/i);
  });
});

describe("the buyers page defines a buyer in the org's own direction", () => {
  it("outbound: the buyer is the organization the order is issued by", async () => {
    directionValue = "outbound";
    renderPage();

    expect(await screen.findByText(buyerDescription("outbound").long)).toBeInTheDocument();

    openNewBuyerPanel();
    expect(screen.getByText(buyerDescription("outbound").short)).toBeInTheDocument();
  });

  it("inbound: the buyer is the customer sending orders in", async () => {
    directionValue = "inbound";
    renderPage();

    expect(await screen.findByText(buyerDescription("inbound").long)).toBeInTheDocument();

    openNewBuyerPanel();
    expect(screen.getByText(buyerDescription("inbound").short)).toBeInTheDocument();
  });

  it("withholds the direction-specific clause until the direction has been read", async () => {
    // The hook falls back to "outbound" before the org setting resolves. A label
    // may use that fallback; a definition may not.
    directionValue = "outbound";
    directionKnown = false;
    renderPage();

    expect(await screen.findByText(buyerDescription(null).long)).toBeInTheDocument();
    expect(screen.queryByText(buyerDescription("outbound").long)).toBeNull();
    expect(screen.queryByText(buyerDescription("inbound").long)).toBeNull();
  });
});
