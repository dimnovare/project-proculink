// When auto-map fails, the editor says so.
//
// `suggestMappingFields` no longer answers a failed call with `heuristicSuggestFields` (see
// src/lib/api/mapping.ts) — a second, independently written alias table that disagrees with the
// backend on WHICH columns map, not merely on the percentage next to them. Dropping that fallback
// means the query can now reject, and a rejected query renders as `suggestQuery.data === undefined`
// — every `?? []` downstream yields empty, so without this the operator gets an auto-map that
// silently produced nothing, with no reason and no retry.
//
// "Nothing, unexplained" is better than a wrong guess and still not good enough. These pin that
// the failure is named, is retryable, and that no confidence chip appears for suggestions that
// were never received.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/standards/catalog", () => ({ fieldRefList: () => [] }));
vi.mock("./StandardsFieldPopover", () => ({ StandardsFieldPopover: () => null }));
vi.mock("@/lib/api/mapping", () => ({
  getMappingSourceColumns: vi.fn(),
  suggestMappingFields: vi.fn(),
}));
// The REAL ApiHttpError, not a stub: production has exactly one class identity for it
// (api-client re-exports core's), and the banner branches on `instanceof`. A stub here would make
// the test pass for the wrong reason — every error would look like a non-HTTP one.
vi.mock("@/lib/api-client", async () => ({
  getPoMappingTemplates: vi.fn(),
  applyPoMappingTemplate: vi.fn(),
  ApiHttpError: (await vi.importActual<typeof import("@/lib/api/core")>("@/lib/api/core"))
    .ApiHttpError,
}));

import { ApiHttpError } from "@/lib/api/core";

const COLUMNS = ["po_number", "order_date", "item_code", "qty", "buyer_name"];

let suggestRefetch: ReturnType<typeof vi.fn>;
let suggestError: unknown;
let suggestPending = false;

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === "po-mapping-source-columns") {
      return {
        data: { format: "csv", columns: COLUMNS, sourceOrderId: "ord-1", sample: {} },
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
    }
    if (key === "po-mapping-suggest") {
      // What TanStack Query hands the component when the queryFn rejects.
      return {
        data: undefined,
        isLoading: suggestPending,
        isError: !suggestPending,
        error: suggestPending ? null : suggestError,
        refetch: suggestRefetch,
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));

import { PoMappingEditor } from "./PoMappingEditor";

const row = (canonical: string): HTMLElement => {
  const el = document.querySelector(`[data-field="${canonical}"]`);
  if (!el) throw new Error(`no row rendered for ${canonical}`);
  return el as HTMLElement;
};

/**
 * Anti-vacuity floor. "No MATCH chip is rendered" passes trivially against a component that
 * rendered nothing at all, so prove first that the editor is alive and mappable: the detected
 * columns arrived, and the canonical rows the operator maps by hand are on screen.
 */
function floor() {
  expect(screen.getByText("po_number")).toBeTruthy();
  for (const field of ["PoNumber", "OrderDate", "Quantity"]) {
    expect(row(field)).toBeTruthy();
  }
}

function renderEditor() {
  render(
    <PoMappingEditor supplierId="sup-1" initialConfig={null} onSave={vi.fn().mockResolvedValue(undefined)} />,
  );
}

beforeEach(() => {
  suggestRefetch = vi.fn();
  suggestPending = false;
  suggestError = new ApiHttpError("Auto-map failed (HTTP 503).", 503);
});
afterEach(cleanup);

describe("PoMappingEditor — auto-map in flight says so", () => {
  // Before this change the query never rejected, so it always settled fast and an unexplained
  // gap was brief. It can now retry: `classifyApiFailure` allows one more attempt for an
  // unreachable API, and `magicFetch` waits 8s per attempt — so the operator can face a live
  // editor with columns, no suggestions, and no explanation for the better part of 20 seconds.
  // That is the same "silently nothing" the fallback removal exists to stop, just time-boxed.
  it("says it is still looking while the request is in flight", () => {
    suggestPending = true;
    renderEditor();
    floor();

    expect(screen.getByText(/looking for matches/i)).toBeTruthy();
    // …and does not claim failure at the same time.
    expect(screen.queryByText(/couldn['’]t run auto-map/i)).toBeNull();
  });
});

describe("PoMappingEditor — a failed auto-map is reported, not swallowed", () => {
  it("tells the operator auto-map failed instead of showing an empty result", () => {
    renderEditor();
    floor();

    // Apostrophe-agnostic: the copy uses a typographic ’, and the claim under test is the
    // sentence, not the glyph.
    expect(screen.getByText(/couldn['’]t run auto-map/i)).toBeTruthy();
  });

  it("offers a retry that re-runs the request", () => {
    renderEditor();
    floor();

    const retry = screen.getByRole("button", { name: /retry auto-map/i });
    fireEvent.click(retry);

    expect(suggestRefetch).toHaveBeenCalledTimes(1);
  });

  it("says manual mapping still works, because it does", () => {
    renderEditor();
    floor();

    expect(screen.getByText(/map the fields below by hand/i)).toBeTruthy();
  });

  it("shows the server's reason when the server gave one", () => {
    suggestError = new ApiHttpError("Auto-map failed (HTTP 503).", 503);
    renderEditor();
    floor();

    expect(screen.getByText(/Auto-map failed \(HTTP 503\)/)).toBeTruthy();
  });

  it("does not print a raw browser error at the operator", () => {
    // A dropped connection rejects with `TypeError: Failed to fetch`; an 8s `magicFetch` timeout
    // rejects with an AbortError whose message is "signal is aborted without reason". Neither is
    // a sentence an operator can act on, and CLAUDE.md's plain-language rule bans exactly this
    // kind of internal string in user-facing copy. Only a server-attributable reason
    // (`ApiHttpError`, whose message is already sanitised) may be shown verbatim.
    suggestError = new TypeError("Failed to fetch");
    renderEditor();
    floor();

    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(screen.getByText(/couldn['’]t be reached/i)).toBeTruthy();
  });

  it("renders no confidence chip for suggestions it never received", () => {
    renderEditor();
    floor();

    // Neither the heuristic tag nor the model one. There is no score to show, and the local
    // scorer that used to supply one on exactly this path is no longer consulted.
    expect(screen.queryByText(/^MATCH · /)).toBeNull();
    expect(screen.queryByText(/^AI · /)).toBeNull();
  });
});
