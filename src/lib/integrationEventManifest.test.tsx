// The Settings webhook event menu must offer every event the backend will
// deliver — the whole backend list, not a stale subset.
//
// THE DEFECT THIS PINS: the menu was a private three-entry map while the
// backend allow-list (`IntegrationEventTypes.Subscribable`,
// `ProcuLink.Core/Constants/IntegrationEventTypes.cs`) had five entries.
// `order.rejected` and `order.dead_lettered` were emitted by `DeliveryService`
// and accepted by `IntegrationController.Create`, but could not be selected in
// the UI. `order.dead_lettered` is the terminal "the order is NOT coming"
// signal and cannot be derived from the per-attempt `order.failed`, so a
// customer wiring alerts could hear "this try failed" but never "we gave up".
//
// Three layers, following src/test/backendMirror.test.ts:
//   1. Anti-vacuity floor: the mirror itself must have >= 5 entries, so an
//      emptied mirror cannot make the coverage checks pass vacuously.
//   2. Coverage, both directions: the label map and the rendered menu each
//      cover the mirror exactly.
//   3. Cross-repo diff (optional locally, like backendMirror): parse the real
//      C# and diff its Subscribable values against the mirror. The parser is
//      tested against an inline fixture on EVERY run, so a parser that quietly
//      stopped matching cannot "confirm" the mirror by finding nothing. A bad
//      PROCULINK_BACKEND_PATH (file not present) SKIPS locally — it never
//      silently diffs a wrong checkout — but in the backend-mirror CI job,
//      which sets PROCULINK_REQUIRE_BACKEND_MIRROR=1, a missing checkout is a
//      FAILURE, not a skip: that job exists to check the backend out, so "no
//      backend" there means the diff proved nothing and must say so.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  INTEGRATION_EVENT_LABELS,
  SUBSCRIBABLE_INTEGRATION_EVENTS,
} from "@/lib/integrationEventManifest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=connectors"),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    getIntegrations: vi.fn().mockResolvedValue([]),
  };
});

import SettingsPage from "../app/(app)/settings/page";

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("integration event manifest — anti-vacuity floor", () => {
  it("mirrors at least the five events the backend had when this file was written", () => {
    // Asserted from the mirror itself: if someone trims the mirror, every
    // exact-coverage check below could still pass against the trimmed list.
    expect(SUBSCRIBABLE_INTEGRATION_EVENTS.length).toBeGreaterThanOrEqual(5);
    // The two events whose absence WAS the defect stay named here verbatim.
    expect(SUBSCRIBABLE_INTEGRATION_EVENTS).toContain("order.rejected");
    expect(SUBSCRIBABLE_INTEGRATION_EVENTS).toContain("order.dead_lettered");
  });

  it("labels cover the mirror exactly, both directions", () => {
    expect(Object.keys(INTEGRATION_EVENT_LABELS).sort()).toEqual(
      [...SUBSCRIBABLE_INTEGRATION_EVENTS].sort(),
    );
    for (const event of SUBSCRIBABLE_INTEGRATION_EVENTS) {
      expect(INTEGRATION_EVENT_LABELS[event]).toBeTruthy();
    }
  });

  it("keeps user-facing copy free of 'dead letter' jargon", () => {
    for (const label of Object.values(INTEGRATION_EVENT_LABELS)) {
      expect(label.toLowerCase()).not.toContain("dead letter");
      expect(label.toLowerCase()).not.toContain("dead-letter");
    }
  });
});

describe("Settings webhook menu offers the whole backend catalogue", () => {
  it("renders one option per subscribable event, code plus description", async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /add webhook/i }));

    // jsdom mounts both breakpoint trees, so scope to the Event select itself
    // rather than asserting on the document.
    const eventSelect = screen.getByLabelText("Event") as HTMLSelectElement;
    const options = Array.from(eventSelect.options).map((o) =>
      o.textContent?.replace(/\s+/g, " ").trim(),
    );

    // Derived from the mirror — the menu may not drop, add, or reorder events
    // relative to the manifest. On the pre-fix page this fails: the menu had
    // three of the five (missing order.rejected and order.dead_lettered).
    expect(options).toEqual(
      SUBSCRIBABLE_INTEGRATION_EVENTS.map(
        (event) => `${event} — ${INTEGRATION_EVENT_LABELS[event]}`,
      ),
    );

    // Control assertion proving the scoping bites: the select really is the
    // event select, not some other five-option control.
    expect(within(eventSelect).getByText(/order\.dead_lettered/)).toBeInTheDocument();
  });
});

// ── Cross-repo diff ──────────────────────────────────────────────────────────

const EVENT_TYPES_REL = "ProcuLink.Core/Constants/IntegrationEventTypes.cs";

/**
 * Parses `IntegrationEventTypes.cs`: the `public const string` members, and the
 * member names listed in the `Subscribable` array, resolved to their values.
 * Returns null when the file's shape is unrecognisable — the caller must treat
 * that as a FAILURE, not a pass, so a refactored backend file cannot silently
 * retire this diff.
 */
export function parseSubscribableEventValues(cs: string): string[] | null {
  const consts = new Map<string, string>();
  for (const m of cs.matchAll(/public\s+const\s+string\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)) {
    consts.set(m[1], m[2]);
  }
  const arr = cs.match(/Subscribable\s*=\s*new\s*\[\]\s*\{([\s\S]*?)\}\s*;/);
  if (!arr || consts.size === 0) return null;
  const names = Array.from(arr[1].matchAll(/\b([A-Z]\w*)\b/g), (m) => m[1]);
  if (names.length === 0) return null;
  const values: string[] = [];
  for (const name of names) {
    const value = consts.get(name);
    if (!value) return null; // a Subscribable member we cannot resolve — unrecognisable shape
    values.push(value);
  }
  return values;
}

/**
 * The backend checkout, or null. Same resolution as backendMirror.test.ts:
 * PROCULINK_BACKEND_PATH first — but ONLY if the parsed file actually exists
 * there (a bad path must SKIP, never fall through to diffing a wrong tree) —
 * then a sibling `ProcuLink` found by walking up.
 */
function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv) {
    return existsSync(join(fromEnv, EVENT_TYPES_REL)) ? fromEnv : null;
  }
  let dir = resolve(__dirname, "..", "..");
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, EVENT_TYPES_REL))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();
/** CI checks the backend out, so there "no checkout" is a failure and not a reason to skip. */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

describe("cross-repo diff against IntegrationEventTypes.cs", () => {
  it("fails rather than skips when CI required the mirror", () => {
    // The backend-mirror job sets PROCULINK_REQUIRE_BACKEND_MIRROR=1 so that a
    // checkout that did not arrive — a 404 on a renamed repo, an expired token,
    // a path typo — is a red build rather than a politely skipped diff under a
    // green check. Locally, with the flag unset, no backend still skips.
    if (REQUIRE_MIRROR) {
      expect(
        BACKEND,
        "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout was reachable — " +
          `the diff against ${EVENT_TYPES_REL} did not run, so this run proves nothing ` +
          "about src/lib/integrationEventManifest.ts",
      ).not.toBeNull();
    }
  });

  it("parser extracts Subscribable values from a known fixture", () => {
    // Runs everywhere, every time — a parser that stopped matching would
    // otherwise let the diff below pass by comparing nothing.
    const fixture = `
      public static class IntegrationEventTypes
      {
          public const string OrderCreated = "order.created";
          public const string OrderZapped = "order.zapped";
          public static readonly IReadOnlyList<string> Subscribable = new[]
          {
              OrderCreated,
              OrderZapped,
          };
      }`;
    expect(parseSubscribableEventValues(fixture)).toEqual(["order.created", "order.zapped"]);
    // Unrecognisable shapes are null, never a quiet empty list.
    expect(parseSubscribableEventValues("class Nope {}")).toBeNull();
  });

  it.skipIf(!BACKEND)("the mirror matches the backend Subscribable list exactly", () => {
    const cs = readFileSync(join(BACKEND!, EVENT_TYPES_REL), "utf8");
    const values = parseSubscribableEventValues(cs);
    // null means the backend file changed shape — that is drift the mirror has
    // to answer for, not a reason to pass.
    expect(values, `parser could not read ${EVENT_TYPES_REL} — update the parser or the mirror`).not.toBeNull();
    expect([...values!].sort()).toEqual([...SUBSCRIBABLE_INTEGRATION_EVENTS].sort());
  });
});
