// WP-25 — every renamed label still resolves to the SAME route.
//
// WP-25 is rename-only: the words a user reads changed, the URLs did not. That
// promise is only worth anything if it is pinned, because a "rename" that also
// moves an href silently breaks bookmarks, help-article links, ?tab= aliases and
// the e2e path lists. Each row below is (new label → route it must still open),
// taken from DESIGN-DB-1 §6.1–§6.3.
//
// The nav/hub tables are asserted against the real exported registries. The two
// page-level TABS arrays are module-private, so they are asserted against source
// text — the same cheap house pattern changelog-append-only.test.ts uses, and
// enough to catch a label/id pair drifting apart.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("next/navigation", () => ({ usePathname: () => "/bridge" }));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: null, membership: null }),
  useOrganizationList: () => ({ isLoaded: true, setActive: vi.fn(), userMemberships: { data: [] } }),
  useClerk: () => ({ openCreateOrganization: vi.fn(), openUserProfile: vi.fn(), signOut: vi.fn() }),
  useUser: () => ({ user: null, isLoaded: true }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: { getOrdersSummary: vi.fn() },
  getBillingStatus: vi.fn(),
  checkAdminAccess: vi.fn(),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ labels: { counterpartyPlural: "Suppliers" } }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

import { buildVisibleNav } from "./BridgeSidebar";
import { HUB_TABS, HUB_LABELS, hubForPath, type HubKey } from "./layout/HubTabs";
import { CRUMB_LABELS } from "./breadcrumb";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("renamed sidebar labels keep their routes", () => {
  // WP-26 removed buildVisibleNav's launch-flag `opts`: with four items there is
  // nothing left to narrow, so the nav is no longer gated.
  const nav = buildVisibleNav("Suppliers", true);
  const items = [...nav.main.flatMap((s) => s.items), ...nav.tail];
  const hrefFor = (label: string) => items.find((i) => i.label === label)?.href;

  // "Overview" is no longer a sidebar item — WP-26 made it the Activity hub's
  // first tab, and the "Activity" nav item inherits its /bridge href.
  const rows: Array<[string, string, string]> = [
    ["Orders", "/inbox", "§6.1 #2 Inbox → Orders"],
    ["Suppliers", "/library/suppliers", "§6.1 #6 Partners → Suppliers"],
    ["Activity", "/bridge", "§6.1 #8 Operations → Activity"],
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

describe("renamed hub tab labels keep their routes", () => {
  const tabs = (Object.keys(HUB_TABS) as HubKey[]).flatMap((k) => HUB_TABS[k]);
  const hrefFor = (label: string) => tabs.find((t) => t.label === label)?.href;

  const rows: Array<[string, string, string]> = [
    ["Item codes", "/library/mappings", "§6.1 #17 Mappings → Item codes"],
    ["Format reference", "/library/standards", "§6.1 #24 Standards → Format reference"],
    ["System status", "/operations/health", "§6.1 #25 System health → System status"],
    ["Issues", "/operations/exceptions", "§6.1 #26 Exceptions → Issues"],
    ["Deliveries", "/operations/log", "§6.1 #27 Delivery log → Deliveries"],
    // §6.1 #28 renamed Connectors → "Delivery channels". That tab is gone: the
    // page behind it (/operations/connectors) was deleted on 2026-08-13, so a
    // rename has nothing left to preserve — see the assertion below.
    ["Suppliers", "/library/suppliers", "§6.1 #14 unchanged"],
    ["Buyers", "/library/buyers", "§6.1 #15 unchanged"],
  ];

  for (const [label, href, why] of rows) {
    it(`"${label}" → ${href}  (${why})`, () => expect(hrefFor(label)).toBe(href));
  }

  // FE #47 retired /library/rules and /library/templates behind permanent
  // redirects, so the tabs WP-25 would have renamed no longer exist. A rename
  // must not resurrect a retired destination.
  it("offers no tab for a route FE #47 retired", () => {
    for (const href of ["/library/rules", "/library/templates"]) {
      expect(tabs.map((t) => t.href)).not.toContain(href);
    }
  });

  // Same rule, later retirements: a renamed label must not keep a tab alive for
  // a page that no longer exists. /operations/webhooks was deleted on 2026-08-08
  // and /operations/connectors on 2026-08-13; both are permanent redirects now
  // (src/lib/retired-routes.ts), and a redirect has no tab.
  it("offers no tab for a route retired after the hub-label rename", () => {
    for (const href of ["/operations/webhooks", "/operations/connectors"]) {
      expect(tabs.map((t) => t.href)).not.toContain(href);
    }
  });

  it("every hub route still claims its hub (hubForPath is untouched)", () => {
    for (const key of Object.keys(HUB_TABS) as HubKey[]) {
      for (const t of HUB_TABS[key]) expect(hubForPath(t.href)).toBe(key);
    }
  });

  it("the hub display names match the sidebar words they mirror", () => {
    expect(HUB_LABELS.suppliers).toBe("Suppliers");
    expect(HUB_LABELS.activity).toBe("Activity");
  });
});

describe("renamed breadcrumb labels keep their route segments", () => {
  // The KEY is the URL segment. A rename may change the value, never the key.
  const rows: Array<[string, string]> = [
    ["bridge", "Overview"],
    ["inbox", "Orders"],
    ["mappings", "Item codes"],
    ["standards", "Format reference"],
    ["operations", "Activity"],
    ["log", "Deliveries"],
    ["exceptions", "Issues"],
    ["health", "System status"],
    ["asns", "Shipping notices"],
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

describe("renamed supplier tabs keep their ?tab= ids", () => {
  const src = read("src/components/bridge/SupplierDockProfile.tsx");
  const rows: Array<[string, string]> = [
    ["mappings", "Item codes"],
    ["po-mapping", "Order layout"],
    ["acceptance", "Rules"],
    ["history", "Changes"],
    ["overview", "Overview"],
    ["delivery", "Delivery"],
  ];
  for (const [id, label] of rows) {
    it(`?tab=${id} → "${label}"`, () => {
      expect(src).toMatch(new RegExp(`id:\\s*"${id}",\\s*label:\\s*"${label}"`));
    });
  }
  it("drops the body-copy apology the old tab names needed", () => {
    expect(src).not.toContain("use the Mappings tab instead");
  });
});

describe("renamed settings tabs keep their ?tab= ids", () => {
  const src = read("src/app/(app)/settings/page.tsx");
  const rows: Array<[string, string]> = [
    ["org", "Workspace"],
    ["billing", "Plan & billing"],
    ["sftp", "SFTP folder"],
    ["s3", "Cloud folder \\(S3 or R2\\)"],
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
      'type SettingsTab = "org" | "billing" | "email" | "sftp" | "s3" | "api" | "connectors"',
    );
  });
});
