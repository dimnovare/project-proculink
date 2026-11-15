// WP-25 — every renamed label still resolves to the SAME route.
//
// WP-25 is rename-only: the words a user reads changed, the URLs did not. That
// promise is only worth anything if it is pinned, because a "rename" that also
// moves an href silently breaks bookmarks, help-article links, ?tab= aliases and
// the e2e path lists. Each row below is (new label → route it must still open),
// taken from DESIGN-DB-1 §6.1–§6.3.
//
// The nav/hub tables and the Settings tabs are asserted against the real exported
// registries (`SETTINGS_TABS` and its reader live in src/lib/settingsTabs.ts).

import { describe, it, expect, vi } from "vitest";
import { readSettingsTab, SETTINGS_TABS } from "@/lib/settingsTabs";

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

describe("renamed settings tabs keep their ?tab= ids", () => {
  const rows: Array<[string, string]> = [
    ["org", "Workspace"],
    ["destinations", "Destinations"],
    ["billing", "Plan & billing"],
    ["api", "API keys"],
  ];
  for (const [id, label] of rows) {
    it(`?tab=${id} → "${label}"`, () => {
      expect(SETTINGS_TABS.find((t) => t.id === id)?.label).toBe(label);
      expect(readSettingsTab(new URLSearchParams(`tab=${id}`))).toBe(id);
    });
  }
  it("an old ?tab=connectors link (the retired Notifications tab) still lands, on Workspace where its settings live", () => {
    expect(readSettingsTab(new URLSearchParams("tab=connectors"))).toBe("org");
  });
});
