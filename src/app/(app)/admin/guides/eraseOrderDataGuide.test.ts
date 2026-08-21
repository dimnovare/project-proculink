import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { GUIDES, linkedGuides, publicGuides, getGuideBySlug } from "@/lib/guides";
import { stripComments, syntaxFor } from "@/test/sourceScan";

// The erasure runbook — and the decision it records.
//
// Five admin endpoints gained a browser control this week. TWO DID NOT, on purpose:
//
//   DELETE /api/admin/organisations/{orgId}/orders/{orderId}
//   POST   /api/admin/organisations/{orgId}/orders/bulk-erase
//
// Both hard-delete another tenant's data and neither can be undone. Deliberate
// friction is the control: they stay curl-only and are documented instead. That is a
// decision, not an omission, and a decision that lives only in a commit message is a
// decision the next session will quietly reverse — so it is pinned twice here: the
// runbook must exist and carry the details, and the admin UI must NOT grow a button.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const GUIDE_DIR = join(REPO_ROOT, "src", "app", "(app)", "admin", "guides", "erase-order-data");
const ADMIN_DIR = join(REPO_ROOT, "src", "app", "(app)", "admin");

function content(): string {
  return readFileSync(join(GUIDE_DIR, "content.mdx"), "utf8");
}

/**
 * Every .tsx under src/app/(app)/admin, one level deep — the screen files, with
 * comments stripped.
 *
 * STRIPPING IS LOAD-BEARING, not tidiness. The screen carries a header comment
 * saying which two endpoints it deliberately does NOT call and naming them; a raw
 * text scan reads that as a call site and fails on the very note that documents the
 * decision. That is the same defect this repo's endpoint guard already pins as
 * "ignores an API path that exists only in a comment", so it uses the same
 * stripper rather than a second copy.
 */
function adminScreenSources(): string[] {
  return readdirSync(ADMIN_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.includes(".test."))
    .map((e) => stripComments(readFileSync(join(ADMIN_DIR, e.name), "utf8"), syntaxFor(e.name)));
}

describe("erase-order-data — registered the way the shipped admin guides are", () => {
  it("is in the registry, live, admin-audience, in the Admin section", () => {
    const guide = getGuideBySlug("erase-order-data");
    expect(guide, "guides.ts has no erase-order-data entry").toBeDefined();
    expect(guide!.href).toBe("/admin/guides/erase-order-data");
    expect(guide!.audience).toBe("admin");
    expect(guide!.section).toBe("Admin");
    expect(guide!.status).toBe("live");
    expect(guide!.minutes).toBeGreaterThan(0);
  });

  it("has both route files the admin guide shape requires", () => {
    // Admin guides are a gated Server Component page.tsx with the prose in a
    // sibling content.mdx — a client-side gate would ship the runbook to every
    // signed-in browser and merely refuse to paint it.
    expect(existsSync(join(GUIDE_DIR, "page.tsx"))).toBe(true);
    expect(existsSync(join(GUIDE_DIR, "content.mdx"))).toBe(true);
  });

  it("calls requireAdminOrNotFound before rendering, like the unfreeze runbook", () => {
    const page = readFileSync(join(GUIDE_DIR, "page.tsx"), "utf8");
    expect(page).toContain("requireAdminOrNotFound");
    expect(page).toContain("guideMetadata");
  });

  it("is linked from the index but never from anything public", () => {
    expect(linkedGuides().map((g) => g.slug)).toContain("erase-order-data");
    expect(publicGuides().map((g) => g.slug)).not.toContain("erase-order-data");
  });

  it("floor: the registry still holds the two admin guides this one joins", () => {
    // Anti-vacuity. If GUIDES were empty every "not in publicGuides" assertion
    // above would pass for the wrong reason.
    const admin = GUIDES.filter((g) => g.audience === "admin").map((g) => g.slug);
    expect(admin).toContain("onboard-a-new-client");
    expect(admin).toContain("unfreeze-a-pilot-workspace");
  });
});

describe("erase-order-data — the runbook carries what the endpoints actually require", () => {
  it("documents both routes", () => {
    const mdx = content();
    expect(mdx).toContain("/api/admin/organisations/");
    expect(mdx).toMatch(/orders\/\$?\{?ORDER_ID\}?|orders\/\$ORDER_ID/);
    expect(mdx).toContain("orders/bulk-erase");
  });

  it("shows a curl for each — this is the only way to run them", () => {
    const mdx = content();
    expect(mdx).toMatch(/curl -X DELETE/);
    expect(mdx).toMatch(/curl -X POST[\s\S]*bulk-erase/);
  });

  it("names the bulk filter's at-least-one-criterion refusal", () => {
    // An empty filter is a 400, and that guard is the only thing between a
    // fat-fingered `{}` and an entire organisation. It has to be in the prose.
    const mdx = content();
    expect(mdx).toMatch(/poNumberPrefix/);
    expect(mdx).toMatch(/olderThan/);
    expect(mdx).toMatch(/at least one/i);
    expect(mdx).toMatch(/400/);
  });

  it("says the erase is irreversible and audited", () => {
    const mdx = content();
    expect(mdx).toMatch(/irreversible|cannot be undone/i);
    expect(mdx).toMatch(/admin\.order\.erased/);
    expect(mdx).toMatch(/admin\.orders\.bulk_erased/);
  });

  it("says what comes back", () => {
    const mdx = content();
    expect(mdx).toMatch(/ordersErased/);
    expect(mdx).toMatch(/r2ObjectsDeleted|R2ObjectsDeleted/);
    expect(mdx).toMatch(/404/);
  });
});

describe("erase-order-data — the friction stays friction", () => {
  it("no admin screen calls either erasure endpoint", () => {
    const sources = adminScreenSources();
    expect(sources.length, "the admin screen sweep found no files").toBeGreaterThan(3);
    for (const src of sources) {
      expect(src).not.toContain("bulk-erase");
      expect(src).not.toMatch(/eraseOrder|bulkErase/);
    }
  });

  it("floor: the stripped corpus still contains the calls the screen DOES make", () => {
    // Without this, a stripper that returned "" — or a sweep that read the wrong
    // directory — would prove "no erasure call" for every file at once, which is
    // the shape of a guard that has quietly stopped guarding.
    const all = adminScreenSources().join("\n");
    expect(all).toContain("getAdminOverview");
    expect(all).toContain("setOrgAccountStatus");
    expect(all).toContain("setOrgRetention");
  });
});
