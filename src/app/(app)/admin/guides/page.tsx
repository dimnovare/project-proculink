import Link from "next/link";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { GuideIndex } from "@/components/help/guide/GuideIndex";
import { requireAdminOrNotFound } from "@/lib/admin-guard";
import { pageMetadata } from "@/lib/seo";

// The runbook index is gated the same way the runbooks are: nothing renders
// until the API confirms the caller is on the admin allowlist.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  path: "/admin/guides",
  title: "Internal runbooks — ProcuLink admin",
  description: "Internal operator runbooks. Visible only to ProcuLink admins.",
  noindex: true,
});

export default async function AdminGuidesIndexPage() {
  await requireAdminOrNotFound();

  return (
    <PageShell>
      <header>
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase"
          style={{
            color: "var(--amber-text)",
            background: "var(--amber-soft)",
            letterSpacing: "0.05em",
          }}
        >
          Internal · admins only
        </span>
        <h1
          className="mt-3.5"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(24px, 4vw, 30px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "var(--ink)",
            margin: "12px 0 0",
          }}
        >
          Operator runbooks
        </h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--ink-muted)", lineHeight: 1.65 }}>
          Step-by-step procedures for running the platform, not for using it. These pages are
          served only to allowlisted admin accounts and are excluded from the sitemap and
          robots.txt.
        </p>
      </header>

      <GuideIndex audience="admin" />

      <p className="mt-9 text-[13.5px]" style={{ color: "var(--ink-muted)" }}>
        Customer-facing walkthroughs live in the{" "}
        <Link
          href="/help/guides"
          className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
          style={{ color: "var(--brand-blue-deep)" }}
        >
          public guide library →
        </Link>
      </p>
    </PageShell>
  );
}
