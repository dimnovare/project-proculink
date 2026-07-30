// WP-20 D6 — the file-drop resend caveat must match what the backend actually does.
//
// This sentence renders on the LIVE connector manifests, not only the mock ones (withResendCaveat
// is applied to both), so it is operator-facing copy about real purchase orders. It used to promise
// "a repeat send overwrites the same file on the server", which stopped being true the moment a
// per-supplier "replace existing files" setting existed: with it off, the repeat refuses, and the
// backend now holds the order for a human instead of retrying it into dead-letter. Both halves have
// to survive, and neither may be overstated.
//
// The manifests here come through the REAL code path (apiFetch stubbed), because the live path is
// the one the claim was wrong on — the mock manifests were never the risk.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectorManifest, DeliveryProtocol } from "./types";

// USE_MOCK: false pins the LIVE code path — the one the wrong claim shipped on.
vi.mock("./core", () => ({
  authHeader: async () => ({}),
  API_BASE_URL: "http://api.test",
  USE_MOCK: false,
}));

import { listConnectorManifests } from "./connectors";

function bareManifest(key: DeliveryProtocol): ConnectorManifest {
  return {
    key,
    label: key.toUpperCase(),
    summary: "",
    fields: [],
    resendCaveat: null,
  } as unknown as ConnectorManifest;
}

const PROTOCOLS: DeliveryProtocol[] = [
  "http",
  "sftp",
  "ftps",
  "smtp",
  "email",
  "erp_erply",
  "erp_directo",
];

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(PROTOCOLS.map(bareManifest)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function liveManifests(): Promise<ConnectorManifest[]> {
  return listConnectorManifests();
}

describe("resend caveat — SFTP/FTPS", () => {
  it("promises no duplicate without promising an overwrite", async () => {
    const manifests = await liveManifests();

    for (const key of ["sftp", "ftps"] as const) {
      const caveat = manifests.find((m) => m.key === key)?.resendCaveat ?? "";

      expect(caveat, `${key} must carry a resend caveat on the live manifest`).not.toBe("");

      // The guarantee that is still true: one order, one file name, never two copies.
      expect(caveat).toMatch(/same file name/i);
      expect(caveat).toMatch(/two copies/i);

      // The claim that is not: an unconditional overwrite.
      expect(
        caveat,
        "with replace-existing off a repeat send refuses — the copy must not promise it overwrites",
      ).not.toMatch(/A repeat send overwrites/i);

      // And the operator has to be told what happens instead of an overwrite.
      expect(caveat).toMatch(/replace existing files/i);
    }
  });

  it("does not leak internal vocabulary into operator-facing copy", async () => {
    const manifests = await liveManifests();

    for (const m of manifests) {
      const caveat = (m.resendCaveat ?? "").toLowerCase();
      for (const jargon of ["idempot", "resendsafety", "dead-letter", "re-drive", "dispatching row"]) {
        expect(caveat, `${m.key} caveat leaks "${jargon}"`).not.toContain(jargon);
      }
    }
  });
});
