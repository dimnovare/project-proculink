// WP-25 — every renamed label still resolves to the SAME route.
//
// WP-25 is rename-only: the words a user reads changed, the URLs did not. That
// promise is only worth anything if it is pinned, because a "rename" that also
// moves an href silently breaks bookmarks, help-article links, ?tab= aliases and
// the e2e path lists. Each row below is (new label → route it must still open),
// taken from DESIGN-DB-1 §6.1–§6.3.
//
// The nav/hub tables are asserted against the real exported registries. The
// page-level TABS array is module-private, so it is asserted against source
// text — the same cheap house pattern changelog-append-only.test.ts uses, and
// enough to catch a label/id pair drifting apart.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("next/navigation", () => ({ usePathname: () => "/documents" }));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: null, membership: null }),
  useOrganizationList: () => ({ isLoaded: true, setActive: vi.fn(), userMemberships: { data: [] } }),
  useClerk: () => ({ openCreateOrganization: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn() }),
  useUser: () => ({ user: null, isLoaded: true }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@/lib/api-client", () => ({
  getBillingStatus: vi.fn(),
  checkAdminAccess: vi.fn(),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { buildVisibleNav } from "./BridgeSidebar";
import { CRUMB_LABELS } from "./breadcrumb";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("renamed sidebar labels keep their routes", () => {
  // WP-26 removed buildVisibleNav's launch-flag `opts`: with four items there is
  // nothing left to narrow, so the nav is no longer gated.
  const nav = buildVisibleNav(true);
  const items = [...nav.main.flatMap((s) => s.items), ...nav.tail];
  const hrefFor = (label: string) => items.find((i) => i.label === label)?.href;

  // Documents and Activity pointed at the order hubs (/inbox, /bridge) until the
  // order screens went on 2026-11-13; both labels now open the document tool's
  // pages, and the old URLs 308 (src/lib/retired-routes.ts).
  const rows: Array<[string, string, string]> = [
    ["Documents", "/documents", "§6.1 #2 Inbox → Documents"],
    ["Activity", "/operations/log", "§6.1 #8 Operations → Activity"],
    ["Settings", "/settings", "§6.1 #32 unchanged"],
    ["Admin", "/admin", "§6.1 #30 unchanged"],
    ["Help & support", "/help", "§6.1 #31 unchanged"],
  ];

  for (const [label, href, why] of rows) {
    it(`"${label}" → ${href}  (${why})`, () => expect(hrefFor(label)).toBe(href));
  }

  it("retires the old words from the sidebar entirely", () => {
    const labels = items.map((i) => i.label);
    for (const retired of ["Dashboard", "Inbox", "Partners", "Operations"]) {
      expect(labels).not.toContain(retired);
    }
  });
});

describe("renamed breadcrumb labels keep their route segments", () => {
  // The KEY is the URL segment. A rename may change the value, never the key.
  const rows: Array<[string, string]> = [
    ["operations", "Activity"],
    ["log", "Deliveries"],
  ];
  for (const [segment, label] of rows) {
    it(`/${segment} → "${label}"`, () => expect(CRUMB_LABELS[segment]).toBe(label));
  }

  // A crumb for a retired route can never render — /library/rules and
  // /library/templates permanently redirect (src/lib/retired-routes.ts).
  it("carries no label for a segment FE #47 retired", () => {
    for (const segment of ["rules", "templates", "drafts"]) {
      expect(CRUMB_LABELS[segment]).toBeUndefined();
    }
  });

  // `connectors` had the §6.1 #28 label "Delivery channels" until 2026-08-13,
  // when /operations/connectors was deleted. A crumb for a permanent redirect
  // can never render, so the label went with the page.
  it("carries no label for a segment retired after the rename", () => {
    for (const segment of ["connectors", "webhooks"]) {
      expect(CRUMB_LABELS[segment]).toBeUndefined();
    }
  });
});

describe("renamed settings tabs keep their ?tab= ids", () => {
  const src = read("src/app/(app)/settings/page.tsx");
  const rows: Array<[string, string]> = [
    ["org", "Workspace"],
    ["billing", "Plan & billing"],
    ["api", "API keys"],
    ["connectors", "Notifications"],
  ];
  for (const [id, label] of rows) {
    it(`?tab=${id} → "${label.replace(/\\/g, "")}"`, () => {
      expect(src).toMatch(new RegExp(`id:\\s*"${id}",\\s*label:\\s*"${label}"`));
    });
  }
  it("keeps the SettingsTab union unchanged so old deep links still validate", () => {
    expect(src).toContain(
      'type SettingsTab = "org" | "billing" | "api" | "connectors"',
    );
  });
});
