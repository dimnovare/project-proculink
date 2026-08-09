import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditLogEntry } from "@/lib/api-client";
import {
  AUDIT_ACTION_FACTS,
  EXPLAINED_AUDIT_ACTIONS,
  auditEventReason,
  isSuccessKind,
  type AuditActionFact,
} from "@/lib/auditActionManifest";
import { SUPPLIER_REASON_MAX } from "./problem/supplierReasonText";

// ─────────────────────────────────────────────────────────────────────────────
// The delivery log could say an order failed, and never say why.
//
// THE DEFECT, VERBATIM. `git grep payload -- src/components/bridge/CrossingsLog.tsx`
// returned nothing, while `AuditLogEntry` has carried `payload` the whole time and
// `AuditController.cs:191` fills it from the `jsonb` column. `mapApiEntry` built its
// LogEntry out of ts / po / buyer / supplier / actor / message and dropped the
// payload on the floor, so the audit trail's own explanation — `error` on a
// TransformFailed, `lastError` on a dead-lettered delivery, the blocker sentences on
// an AcceptanceBlocked — never reached the screen. The expanded panel DID have an
// error banner; it was gated on `c.error`, which only the `isApiMockMode` demo rows
// ever set. A real operator expanded a failed row and got an empty card with three
// buttons in it.
//
// PR #112 made this screen tell the truth about WHETHER something failed. This is the
// other half: WHY. A failed first delivery is the normal outcome of a first supplier
// configuration, and this screen is where that operator goes.
//
// WHAT THESE TESTS PIN, in the three directions the brief names:
//
//   1. a failure carrying a reason RENDERS it
//   2. a failure carrying none renders NO INVENTED reason
//   3. a success does not GAIN one — including when its payload has error-shaped keys
//
// The action set is DERIVED from AUDIT_ACTION_FACTS, never typed out here. #112's
// defect survived precisely because a hand-typed list of actions (in snake_case, with
// a success fallback) was checked against tests that were also hand-typed, so both
// halves agreed with each other and neither agreed with the backend. The manifest is
// diffed against the real C# by src/test/auditActionMirror.test.ts, including — since
// this change — the payload key names themselves.
// ─────────────────────────────────────────────────────────────────────────────

const getAuditLog = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("@/lib/api-client", () => ({
  getAuditLog: (...a: unknown[]) => getAuditLog(...a),
  isApiMockMode: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

import { CrossingsLog } from "./CrossingsLog";

// ── Derived populations ──────────────────────────────────────────────────────

/** Actions the manifest says carry an explanation. */
const EXPLAINED: AuditActionFact[] = AUDIT_ACTION_FACTS.filter((f) => f.reasonKeys.length > 0);

/** Failures with nothing fit to show — the "say nothing" population. */
const SILENT_FAILURES: AuditActionFact[] = AUDIT_ACTION_FACTS.filter(
  (f) => f.kind === "failed" && f.reasonKeys.length === 0,
);

/** Everything that may render green. */
const SUCCESSES: AuditActionFact[] = AUDIT_ACTION_FACTS.filter((f) => isSuccessKind(f.kind));

/** Every reason key any action declares, so a payload can be built that has them all. */
const EVERY_REASON_KEY = [...new Set(AUDIT_ACTION_FACTS.flatMap((f) => f.reasonKeys))];

/**
 * The anti-vacuity floor.
 *
 * Called FIRST inside every negative test, before the assertion that something is
 * absent. Without it, a manifest whose `reasonKeys` had been emptied — or a filter
 * that stopped matching — would make "renders no reason" true for all the wrong
 * reasons, and this whole file would go green over a screen that had gone silent
 * again. It throws rather than skipping, so a collapsed population is a build failure.
 */
function floor(): void {
  expect(EXPLAINED, "no action declares a reason key — the manifest has gone silent").toHaveLength(9);
  expect(SILENT_FAILURES.length, "no failure lacks a reason key").toBeGreaterThanOrEqual(6);
  expect(SUCCESSES.length, "no success kinds to check").toBeGreaterThanOrEqual(3);
  expect(EVERY_REASON_KEY.length, "no reason keys at all").toBeGreaterThanOrEqual(4);
  // The manifest's derived export and the local filter must describe one population.
  expect([...EXPLAINED_AUDIT_ACTIONS].sort()).toEqual(EXPLAINED.map((f) => f.action).sort());
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// No real counterparty text anywhere in this file. Rendering a live reason is fine —
// it is the operator's own data — but committing one to a public repo is not, and a
// failure reason is exactly where a supplier's name, endpoint or contact turns up.

const REASON = "The output template referenced a field the order does not have.";

const BASE: Omit<AuditLogEntry, "id" | "action" | "message" | "payload"> = {
  ts: "2026-08-06T09:15:00.000Z",
  orderId: "ord-aaa",
  poNumber: "PO-4711",
  buyerName: "Heinrich Industries",
  supplierName: "Nordmark",
  format: "PDF",
  actorType: "system",
  actorName: "System",
  actorInitials: "SY",
};

function evt(action: string, payload: unknown): AuditLogEntry {
  return { ...BASE, id: "e1", action, message: `${action} · PO-4711`, payload };
}

/**
 * A payload carrying `text` under this action's own first reason key.
 *
 * Two value shapes, mirroring `proseFromValue`: a plain string, and the array of
 * `{ code, line, message }` that `AcceptanceBlocked` writes into `blockers`.
 */
function payloadWithReason(fact: AuditActionFact, text: string): Record<string, unknown> {
  const key = fact.reasonKeys[0];
  return key === "blockers" ? { blockers: [{ code: "rule.qty", line: 3, message: text }] } : { [key]: text };
}

/** A payload carrying EVERY reason key any action declares, all populated. */
function fatPayload(text: string): Record<string, unknown> {
  return Object.fromEntries(
    EVERY_REASON_KEY.map((k) => [k, k === "blockers" ? [{ code: "rule.qty", message: text }] : text]),
  );
}

function apiPage(events: AuditLogEntry[]) {
  return { events, total: events.length, page: 1, pageSize: 50 };
}

function renderLog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrossingsLog />
    </QueryClientProvider>,
  );
}

/** Expand the single row on screen — the reason lives in the expanded panel. */
async function openRow(): Promise<void> {
  const po = await screen.findByText("PO-4711");
  (po.closest("button") as HTMLButtonElement).click();
}

function reasonBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="audit-reason"]');
}

beforeEach(() => {
  getAuditLog.mockReset();
  searchParams = new URLSearchParams();
});

afterEach(cleanup);

// ── 1. A failure carrying a reason renders it ────────────────────────────────

describe("CrossingsLog — the reason the backend already sent", () => {
  it.each(EXPLAINED.map((f) => [f.action, f] as const))(
    "%s renders the reason out of its own payload key",
    async (_action, fact) => {
      getAuditLog.mockResolvedValue(apiPage([evt(fact.action, payloadWithReason(fact, REASON))]));

      renderLog();
      await openRow();

      const block = reasonBlock();
      expect(block, `${fact.action} rendered no reason though its payload carried one`).not.toBeNull();
      expect(block!.textContent).toContain(REASON);
    },
  );

  it("reads the key the action actually uses, not a single guessed name", () => {
    floor();
    // Five different key names carry prose across the vocabulary. A reader with one
    // hard-coded key would explain some failures and silently drop the rest — and the
    // one it would most likely pick, `error`, is absent from the dead-lettered
    // delivery, which is the closest thing this log has to a delivery failure.
    expect(new Set(EVERY_REASON_KEY).size).toBeGreaterThanOrEqual(4);
    expect(auditEventReason("DeliveryDeadLettered", { error: REASON })).toBeNull();
    expect(auditEventReason("DeliveryDeadLettered", { lastError: REASON })).toBe(REASON);
    expect(auditEventReason("TransformFailed", { lastError: REASON })).toBeNull();
    expect(auditEventReason("TransformFailed", { error: REASON })).toBe(REASON);
  });
});

// ── 2. A failure carrying no reason renders no invented one ──────────────────

describe("CrossingsLog — a failure with nothing to say says nothing", () => {
  it.each(EXPLAINED.map((f) => [f.action, f] as const))(
    "%s renders no reason when the payload is absent",
    async (_action, fact) => {
      floor();
      // Legacy rows predate their writer and the DTO emits `payload: null` for them.
      getAuditLog.mockResolvedValue(apiPage([evt(fact.action, null)]));

      renderLog();
      await openRow();

      expect(reasonBlock(), `${fact.action} invented a reason from a null payload`).toBeNull();
    },
  );

  it.each(EXPLAINED.map((f) => [f.action, f] as const))(
    "%s renders no reason when the payload has no reason key",
    async (_action, fact) => {
      floor();
      getAuditLog.mockResolvedValue(apiPage([evt(fact.action, { stage: "transform", attemptCount: 3 })]));

      renderLog();
      await openRow();

      expect(reasonBlock(), `${fact.action} invented a reason from a payload without one`).toBeNull();
    },
  );

  it.each(SILENT_FAILURES.map((f) => [f.action] as const))(
    "%s stays silent even when the payload carries every other action's reason key",
    async (action) => {
      floor();
      // The strongest form of the negative. These failures have no key the manifest
      // trusts — `DeliverySlaBreached` writes its own action name into `reason`, and
      // the inbound-email refusals carry routing facts and no prose at all. A reader
      // that sniffed for an error-shaped property instead of asking the manifest would
      // light up here, and would be printing an engine identifier as an explanation.
      getAuditLog.mockResolvedValue(apiPage([evt(action, fatPayload(REASON))]));

      renderLog();
      await openRow();

      expect(reasonBlock(), `${action} rendered a reason it has no key for`).toBeNull();
    },
  );

  it("says nothing when the gate could not answer, rather than printing its slug", async () => {
    floor();
    // AcceptanceBlocked has two arms. The refusal lists `blockers`; the arm where the
    // gate itself was unavailable ships `blockers: []` and `error:
    // "acceptance_gate_unavailable"` — a machine marker, deliberately distinct from a
    // supplier's refusal. Rendering it would tell an operator their supplier refused
    // the order with the words "acceptance gate unavailable", which is a fabricated
    // cause with a real-looking shape.
    getAuditLog.mockResolvedValue(
      apiPage([evt("AcceptanceBlocked", { blockers: [], stage: "transform", error: "acceptance_gate_unavailable" })]),
    );

    renderLog();
    await openRow();

    expect(reasonBlock()).toBeNull();
    expect(screen.queryByText(/acceptance_gate_unavailable/)).toBeNull();
  });

  it("says nothing when the key is present but null", async () => {
    floor();
    // `DeliveryDeadLettered.lastError` is `string?`. JSON null is reachable.
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryDeadLettered", { attemptCount: 5, lastError: null })]));

    renderLog();
    await openRow();

    expect(reasonBlock()).toBeNull();
  });

  it("says nothing for an action this build has never heard of", async () => {
    floor();
    // An unknown action has no manifest row, so there is no key to trust and no way to
    // know whether its payload's prose is prose. `unknown` already renders as a neutral
    // row; it must not acquire a confident explanation either.
    getAuditLog.mockResolvedValue(apiPage([evt("SomethingNewHappened", fatPayload(REASON))]));

    renderLog();
    await openRow();

    expect(reasonBlock()).toBeNull();
  });
});

// ── 3. A success does not gain a reason ──────────────────────────────────────

describe("CrossingsLog — a success gains no explanation", () => {
  it.each(SUCCESSES.map((f) => [f.action] as const))(
    "%s renders no reason even with a fully populated payload",
    async (action) => {
      floor();
      // Several successes really do carry error-shaped keys — `AcceptanceOverrideUsed`
      // ships a `blocked` list of blocking-rule sentences although the transform went
      // through. "Has an error-ish property" is not "is a failure", and this screen has
      // already once made an unrecognised thing render as a completed delivery.
      getAuditLog.mockResolvedValue(apiPage([evt(action, fatPayload(REASON))]));

      renderLog();
      await openRow();

      expect(reasonBlock(), `${action} is a success but rendered a failure reason`).toBeNull();
    },
  );
});

// ── The text off the wire is not trusted prose ───────────────────────────────

describe("CrossingsLog — the reason goes through the repo's one sanitiser", () => {
  it("does not paste a supplier's HTML error page onto the screen", async () => {
    floor();
    // `DeliveryDeadLettered.lastError` is the dispatcher's sentence with the supplier's
    // own response body concatenated onto it, and a 502 answers with a web page. On
    // 2026-08-06 an authenticated production pass found exactly that markup rendered to
    // an operator as the reason their order failed. Same sanitiser as the Order Problem
    // panel — one door, not two.
    const html = "<!DOCTYPE html><html><head><title>502</title></head><body><h1>Bad Gateway</h1></body></html>";
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryDeadLettered", { lastError: html })]));

    renderLog();
    await openRow();

    expect(document.body.textContent).not.toContain("<!DOCTYPE");
    expect(document.body.textContent).not.toContain("<html>");
    expect(reasonBlock()?.textContent ?? "").not.toContain("<h1>");
  });

  it("lifts the sentence out of a JSON body rather than showing the braces", async () => {
    floor();
    const body = JSON.stringify({ code: "PO_REJECTED", message: "Line 3 has no supplier item code." });
    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryDeadLettered", { lastError: body })]));

    renderLog();
    await openRow();

    expect(reasonBlock()!.textContent).toContain("Line 3 has no supplier item code.");
    expect(reasonBlock()!.textContent).not.toContain("{");
  });
});

// ── Mobile: 390px is the screen this has to survive ──────────────────────────

describe("CrossingsLog — a long reason on a phone", () => {
  const LONG = `${"Delivery was refused by the supplier endpoint. ".repeat(40)}End.`;

  it("keeps enough of a very long reason to still be useful", async () => {
    floor();
    // No payload key is length-capped anywhere in the backend: `TransformFailed.error`
    // can be a raw template exception. The ceiling is the sanitiser's, sized to fit the
    // longest sentence the backend can produce, so the reason is clamped rather than
    // cut to a stub — a truncation that drops the half saying what to do is worse than
    // the overflow it prevents.
    getAuditLog.mockResolvedValue(apiPage([evt("TransformFailed", { error: LONG })]));

    renderLog();
    await openRow();

    const text = reasonBlock()!.textContent ?? "";
    expect(text.length).toBeLessThanOrEqual(SUPPLIER_REASON_MAX + 1);
    expect(text.length).toBeGreaterThan(200);
  });

  it("wraps rather than pushing the card wider than the phone", async () => {
    floor();
    // A flex child sizes to min-content, so without `minWidth: 0` a long reason widens
    // the row past the viewport and the whole 390px card scrolls sideways; without
    // `overflowWrap` an unbroken run — a URL, a stack frame, a supplier's id blob —
    // does the same on its own.
    getAuditLog.mockResolvedValue(
      apiPage([evt("TransformFailed", { error: `https://example.invalid/${"a".repeat(200)}` })]),
    );

    renderLog();
    await openRow();

    const block = reasonBlock()!;
    const span = block.querySelector("span") as HTMLElement;
    expect(span.style.minWidth).toBe("0");
    expect(span.style.overflowWrap).toBe("anywhere");
    // Top-aligned so the warning icon sits on the first line of a paragraph that wraps.
    expect(block.style.alignItems).toBe("flex-start");
  });

  it("renders the reason in the mobile card layout too", async () => {
    floor();
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });
    try {
      getAuditLog.mockResolvedValue(apiPage([evt("TransformFailed", { error: REASON })]));

      renderLog();
      await openRow();

      expect(reasonBlock()!.textContent).toContain(REASON);
    } finally {
      Object.defineProperty(window, "matchMedia", { writable: true, value: original });
    }
  });
});

// ── The block is toned like the row it belongs to ────────────────────────────

describe("CrossingsLog — the reason is toned as what it is", () => {
  it("paints a failure's reason as a failure and a held one as held", async () => {
    floor();
    getAuditLog.mockResolvedValue(apiPage([evt("TransformFailed", { error: REASON })]));
    renderLog();
    await openRow();
    expect(reasonBlock()!.dataset.eventKind).toBe("failed");
    expect(reasonBlock()!.dataset.tone).toBe("danger");
    cleanup();

    getAuditLog.mockResolvedValue(apiPage([evt("DeliveryHeldForBilling", { detail: REASON })]));
    renderLog();
    await openRow();
    // Amber, not red: nothing broke, the order is paused. The same distinction the row
    // badge draws — a held send that reads as a failure is its own small lie. Asserted
    // on `data-tone` because both colours are CSS custom properties, which jsdom leaves
    // unresolved (the reason #112 had to add `data-event-kind` to the badge).
    expect(reasonBlock()!.dataset.eventKind).toBe("held");
    expect(reasonBlock()!.dataset.tone).toBe("amber");
  });
});
