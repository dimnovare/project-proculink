import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// assignSupplier — the client half of the only route out of `unrouted`.
//
// Backend: POST /api/orders/{id:guid}/assign-supplier (OrdersController.AssignSupplier).
// It reads the supplier id from a JSON BODY (`[FromBody] AssignSupplierRequest`), so a
// request without a JSON content-type or with the id in the query string is a 400 that
// looks like a validation bug. It answers:
//   200 → the updated OrderDto, already flipped `unrouted` → `parsing`
//   400 { error } → "A supplierId is required." / "Supplier not found."
//   404 (empty)  → unknown / cross-tenant order
//   409 { error } → the atomic claim matched no row: the order is no longer `unrouted`
//
// The 409 is the whole reason this is tested at the transport layer: it is the ONLY
// signal that another operator (or an ingress re-route) already assigned the order, and
// it is distinguishable from a validation 400 only by the status code. Losing the code —
// e.g. throwing a plain Error the way an earlier draft of retryDelivery did — makes the
// stale-state message in the UI unreachable.

const ORDER_ID = "0a2f7f1e-1c2b-4a55-9a70-9f0d1f4bd001";
const SUPPLIER_ID = "11111111-1111-1111-1111-111111111111";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s before giving up; a loaded
  // stub with no session short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response;
}

describe("assignSupplier — the request the backend can actually read", () => {
  it("POSTs the supplier id as a JSON body to the order's assign-supplier route", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(jsonResponse(200, { id: ORDER_ID, status: "parsing" }));

    await apiClient.assignSupplier(ORDER_ID, SUPPLIER_ID);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(`/api/orders/${ORDER_ID}/assign-supplier`);
    expect(init.method).toBe("POST");
    // [FromBody] binding only fires for a JSON content-type — without this header
    // ASP.NET answers 415/400 and the operator sees "something went wrong".
    expect(new Headers(init.headers).get("Content-Type")).toMatch(/application\/json/i);
    expect(JSON.parse(String(init.body))).toEqual({ supplierId: SUPPLIER_ID });
  });

  it("returns the updated order, which the API has already moved to parsing", async () => {
    const { apiClient } = await import("./api-client");
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: ORDER_ID, status: "parsing", supplierId: SUPPLIER_ID }),
    );

    const order = await apiClient.assignSupplier(ORDER_ID, SUPPLIER_ID);

    expect(order.status).toBe("parsing");
    expect(order.supplierId).toBe(SUPPLIER_ID);
  });
});

describe("assignSupplier — failures keep their status code", () => {
  it("throws an ApiHttpError carrying 409 when the order is no longer awaiting routing", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: "Order is not awaiting routing (it already has a supplier or is in another state)." }),
    );

    const err = await apiClient.assignSupplier(ORDER_ID, SUPPLIER_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    // The status is the only thing that separates "someone beat you to it" from
    // "you picked a supplier that doesn't exist".
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(409);
  });

  it("surfaces the backend's own words for a rejected supplier", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "Supplier not found." }));

    const err = await apiClient.assignSupplier(ORDER_ID, SUPPLIER_ID).catch((e: unknown) => e);

    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(400);
    expect((err as Error).message).toContain("Supplier not found.");
  });

  it("does not choke on a 404 with no JSON body", async () => {
    const { apiClient, ApiHttpError } = await import("./api-client");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => {
        throw new Error("Unexpected end of JSON input");
      },
    } as unknown as Response);

    const err = await apiClient.assignSupplier(ORDER_ID, SUPPLIER_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(404);
  });
});
