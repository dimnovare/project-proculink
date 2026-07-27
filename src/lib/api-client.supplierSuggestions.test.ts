import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Order, Supplier } from "@/types/procurement";

/* =====================================================================
   Mock mode has to be able to REACH the suggestion flow, or nobody can
   QA it without a live backend and a real unrouted document. ord-004 is
   the only unrouted fixture in the mock store, so it is the one that has
   to carry candidates — shaped exactly like the real DTO.
   ===================================================================== */

let apiClient: typeof import("@/lib/api-client").apiClient;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_USE_MOCK", "true");
  vi.resetModules();
  ({ apiClient } = await import("@/lib/api-client"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("mock mode — the unrouted fixture carries supplier suggestions", () => {
  it("gives ord-004 two or three ranked candidates", async () => {
    const order = (await apiClient.getOrderById("ord-004")) as Order;

    expect(order.status).toBe("unrouted");
    const suggestions = order.supplierSuggestions ?? [];
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("shapes them like the real DTO, best first", async () => {
    const order = (await apiClient.getOrderById("ord-004")) as Order;
    const suggestions = order.supplierSuggestions ?? [];
    expect(suggestions.length).toBeGreaterThan(0);

    suggestions.forEach((s, i) => {
      expect(s.id).toEqual(expect.any(String));
      expect(s.supplierId).toEqual(expect.any(String));
      expect(s.supplierName).toEqual(expect.any(String));
      expect(s.rank).toBe(i + 1);
      // A heuristic never claims certainty: the backend clamps at 0.99.
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(0.99);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.signals.length).toBeGreaterThan(0);
      s.signals.forEach((sig) => {
        expect(sig.signal).toEqual(expect.any(String));
        expect(sig.contribution).toEqual(expect.any(Number));
        expect(sig.detail.length).toBeGreaterThan(0);
      });
    });

    const scores = suggestions.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("points every candidate at a supplier that actually exists in mock mode", async () => {
    const order = (await apiClient.getOrderById("ord-004")) as Order;
    const suppliers: Supplier[] = await apiClient.getSuppliers();
    expect((order.supplierSuggestions ?? []).length).toBeGreaterThan(0);

    for (const s of order.supplierSuggestions ?? []) {
      const match = suppliers.find((x) => x.id === s.supplierId);
      expect(match, `suggestion ${s.id} points at a supplier that does not exist`).toBeDefined();
      expect(s.supplierName).toBe(match!.name);
    }
  });

  it("routed orders carry no suggestions", async () => {
    const order = (await apiClient.getOrderById("ord-001")) as Order;
    expect(order.supplierSuggestions ?? []).toHaveLength(0);
  });

  it("accepting a suggestion routes the order and clears the candidates", async () => {
    const before = (await apiClient.getOrderById("ord-004")) as Order;
    const pick = (before.supplierSuggestions ?? [])[0];

    const after = await apiClient.assignSupplier("ord-004", pick.supplierId, pick.id);

    expect(after.supplierId).toBe(pick.supplierId);
    expect(after.supplierName).toBe(pick.supplierName);
    expect(after.status).toBe("parsing");
    expect(after.supplierSuggestions ?? []).toHaveLength(0);
  });

  it("carries the identity fields on mock suppliers, so the profile form has something to bind to", async () => {
    const suppliers: Supplier[] = await apiClient.getSuppliers();
    expect(suppliers.some((s) => s.primaryDomain)).toBe(true);
  });

  it("round-trips identity fields through the supplier update path", async () => {
    const suppliers: Supplier[] = await apiClient.getSuppliers();
    const target = suppliers[0];

    await apiClient.renameSupplier(target.id, {
      name: target.name,
      vatNumber: "EE101234567",
      registrationNumber: "12345678",
      ediCode: "5412345000176",
      primaryDomain: "example.com",
    });

    const after = (await apiClient.getSuppliers()).find((s) => s.id === target.id)!;
    expect(after.vatNumber).toBe("EE101234567");
    expect(after.registrationNumber).toBe("12345678");
    expect(after.ediCode).toBe("5412345000176");
    expect(after.primaryDomain).toBe("example.com");
  });
});
