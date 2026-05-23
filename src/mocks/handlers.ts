/**
 * MSW request handlers — §11 mock data layer
 * Covers every API endpoint the UI needs so the app is fully browsable offline.
 */

import { http, HttpResponse } from "msw";
import { ORDERS, MAPPINGS, RULES, LOG_EVENTS, BUYERS, SUPPLIERS, generateOrders } from "./data";

// 1000-row inbox dataset for the virtualized table
const INBOX_LARGE = generateOrders(1000);

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.proculink.io";

export const handlers = [

  // ── Orders ────────────────────────────────────────────────────────────────

  // GET /orders?page&limit&status&buyerId&supplierId
  http.get(`${BASE}/orders`, ({ request }) => {
    const url    = new URL(request.url);
    const status = url.searchParams.get("status");
    const page   = parseInt(url.searchParams.get("page") ?? "1");
    const limit  = parseInt(url.searchParams.get("limit") ?? "50");
    const buyerId    = url.searchParams.get("buyerId");
    const supplierId = url.searchParams.get("supplierId");

    let filtered = INBOX_LARGE;
    if (status)     filtered = filtered.filter(o => o.status === status);
    if (buyerId)    filtered = filtered.filter(o => o.buyerId === buyerId);
    if (supplierId) filtered = filtered.filter(o => o.supplierId === supplierId);

    const start = (page - 1) * limit;
    return HttpResponse.json({
      total: filtered.length,
      page,
      limit,
      items: filtered.slice(start, start + limit),
    });
  }),

  // GET /orders/:id
  http.get(`${BASE}/orders/:id`, ({ params }) => {
    const order = INBOX_LARGE.find(o => o.id === params.id);
    if (!order) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    return HttpResponse.json(order);
  }),

  // ── Buyers ────────────────────────────────────────────────────────────────

  http.get(`${BASE}/buyers`, () => HttpResponse.json({ items: BUYERS })),

  http.get(`${BASE}/buyers/:id`, ({ params }) => {
    const buyer = BUYERS.find(b => b.id === params.id);
    if (!buyer) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    const orders = ORDERS.filter(o => o.buyerId === buyer.id);
    return HttpResponse.json({ ...buyer, orderCount: orders.length });
  }),

  // ── Suppliers ─────────────────────────────────────────────────────────────

  http.get(`${BASE}/suppliers`, () => HttpResponse.json({ items: SUPPLIERS })),

  http.get(`${BASE}/suppliers/:id`, ({ params }) => {
    const supplier = SUPPLIERS.find(s => s.id === params.id);
    if (!supplier) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    const orders = ORDERS.filter(o => o.supplierId === supplier.id);
    return HttpResponse.json({ ...supplier, orderCount: orders.length });
  }),

  // ── SKU mappings ──────────────────────────────────────────────────────────

  http.get(`${BASE}/mappings`, ({ request }) => {
    const url   = new URL(request.url);
    const supp  = url.searchParams.get("supplierId");
    const src   = url.searchParams.get("source");
    const q     = url.searchParams.get("q")?.toLowerCase();

    let items = MAPPINGS;
    if (supp) items = items.filter(m => m.supplierId === supp);
    if (src)  items = items.filter(m => m.source === src);
    if (q)    items = items.filter(m =>
      m.buyerCode.toLowerCase().includes(q) ||
      m.supplierCode.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
    );
    return HttpResponse.json({ total: items.length, items });
  }),

  http.post(`${BASE}/mappings`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: `m-new-${Date.now()}`, ...body }, { status: 201 });
  }),

  http.patch(`${BASE}/mappings/:id`, async ({ params, request }) => {
    const existing = MAPPINGS.find(m => m.id === params.id);
    if (!existing) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...existing, ...body });
  }),

  // ── Validation rules ──────────────────────────────────────────────────────

  http.get(`${BASE}/rules`, () => HttpResponse.json({ items: RULES })),

  http.patch(`${BASE}/rules/:id`, async ({ params, request }) => {
    const rule = RULES.find(r => r.id === params.id);
    if (!rule) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...rule, ...body });
  }),

  // ── Crossings log ─────────────────────────────────────────────────────────

  http.get(`${BASE}/log`, ({ request }) => {
    const url    = new URL(request.url);
    const type   = url.searchParams.get("type");
    const actor  = url.searchParams.get("actor");
    const limit  = parseInt(url.searchParams.get("limit") ?? "50");

    let items = LOG_EVENTS;
    if (type)  items = items.filter(e => e.type === type);
    if (actor) items = items.filter(e => e.actor === actor);
    return HttpResponse.json({ total: items.length, items: items.slice(0, limit) });
  }),

  http.get(`${BASE}/log/:orderId`, ({ params }) => {
    const items = LOG_EVENTS.filter(e => e.orderId === params.orderId);
    return HttpResponse.json({ items });
  }),

  // ── Dashboard topology ────────────────────────────────────────────────────

  http.get(`${BASE}/topology`, () => {
    const buyers = BUYERS.slice(0, 6).map((b, i) => ({
      id: b.id, name: b.name, code: b.code, y: 120 + i * 80, volume: b.volume,
    }));
    const suppliers = SUPPLIERS.slice(0, 5).map((s, i) => ({
      id: s.id, name: s.name, code: s.code, y: 150 + i * 90, warn: s.health !== "ok",
    }));
    const wires = [
      { b: "B01", s: "S01", weight: 5 as const, health: "ok" as const, alert: undefined },
      { b: "B01", s: "S02", weight: 3 as const, health: "warn" as const, alert: 4 },
      { b: "B02", s: "S03", weight: 4 as const, health: "ok" as const, alert: undefined },
      { b: "B03", s: "S01", weight: 2 as const, health: "ok" as const, alert: undefined },
      { b: "B04", s: "S04", weight: 3 as const, health: "warn" as const, alert: 7 },
      { b: "B06", s: "S05", weight: 4 as const, health: "ok" as const, alert: undefined },
      { b: "B07", s: "S04", weight: 2 as const, health: "ok" as const, alert: undefined },
      { b: "B08", s: "S01", weight: 3 as const, health: "ok" as const, alert: undefined },
    ];
    return HttpResponse.json({ buyers, suppliers, wires });
  }),

  // ── Upload ────────────────────────────────────────────────────────────────

  http.post(`${BASE}/upload`, async () => {
    // Simulate 200ms processing delay
    await new Promise(r => setTimeout(r, 200));
    return HttpResponse.json({
      orderId: `gen-${Date.now()}`,
      status: "extracting",
      message: "Document received and queued for processing",
    }, { status: 202 });
  }),

  // ── Settings ──────────────────────────────────────────────────────────────

  http.get(`${BASE}/workspace`, () => HttpResponse.json({
    name: "Nordic Distribution",
    id: "nd-4f91a2",
    currency: "EUR",
    plan: "starter",
    crossingsUsed: 72,
    crossingsLimit: 100,
  })),

  http.patch(`${BASE}/workspace`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ success: true, ...body });
  }),
];
